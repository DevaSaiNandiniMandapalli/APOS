"""Coordinate-exact PDF to DOCX conversion.

This is deliberately not a reflow converter. Every PDF page becomes a Word
section with the same physical page size, horizontal text lines are written as
page-anchored Word frames at their original baseline, pictures are anchored at
their source bounding boxes, and the remaining vector artwork is rendered once
as a transparent layer behind the text.

The result stays editable (each text line is real Word text) while keeping the
visual position of the source page. Text that cannot be represented faithfully
in a Word frame (rotated page text, vertical writing) is left in the vector
layer instead of being moved.
"""

from __future__ import annotations

import hashlib
import io
import math
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from xml.sax.saxutils import escape as xml_escape

import pymupdf
from PIL import Image

EMU_PER_POINT = 12700
TWIPS_PER_POINT = 20

# Word places the first baseline of a single-spaced line roughly 0.93 em below
# the top of a frame for the common Word fonts. PDF text gives us the exact
# baseline, so this is the only typographic calibration needed.
BASELINE_RATIO = 0.93

VECTOR_DPI = 200
RASTER_DPI = 200
MAX_PAGES = 300
MAX_TEXT_LINES = 30000
MAX_VECTOR_BYTES = 12 * 1024 * 1024
MAX_DOCX_BYTES = 120 * 1024 * 1024

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_FONT_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"arial|helvetica|liberation ?sans|nimbus ?sans", re.I), "Arial"),
    (re.compile(r"times|liberation ?serif|nimbus ?roman", re.I), "Times New Roman"),
    (re.compile(r"courier|liberation ?mono|nimbus ?mono", re.I), "Courier New"),
    (re.compile(r"calibri|carlito", re.I), "Calibri"),
    (re.compile(r"cambria|caladea", re.I), "Cambria"),
    (re.compile(r"verdana", re.I), "Verdana"),
    (re.compile(r"tahoma", re.I), "Tahoma"),
    (re.compile(r"trebuchet", re.I), "Trebuchet MS"),
    (re.compile(r"georgia", re.I), "Georgia"),
    (re.compile(r"segoe", re.I), "Segoe UI"),
    (re.compile(r"dejavu ?sans", re.I), "DejaVu Sans"),
    (re.compile(r"dejavu ?serif", re.I), "DejaVu Serif"),
    (re.compile(r"garamond", re.I), "Garamond"),
    (re.compile(r"book ?antiqua", re.I), "Book Antiqua"),
    (re.compile(r"palatino", re.I), "Palatino Linotype"),
    (re.compile(r"consolas", re.I), "Consolas"),
    (re.compile(r"symbol", re.I), "Symbol"),
    (re.compile(r"wingdings", re.I), "Wingdings"),
)

_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
_ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


@dataclass
class TextRun:
    text: str
    font: str
    size: float
    bold: bool
    italic: bool
    color: str


@dataclass
class TextLine:
    x: float
    baseline: float
    size: float
    height: float
    width: float
    runs: list[TextRun] = field(default_factory=list)


@dataclass
class Picture:
    key: str
    data: bytes
    extension: str
    x: float
    y: float
    width: float
    height: float


@dataclass
class PageLayout:
    width: float
    height: float
    lines: list[TextLine] = field(default_factory=list)
    pictures: list[Picture] = field(default_factory=list)
    overlay: bytes | None = None
    rasterized: bool = False


def _clean_text(value: str) -> str:
    value = value.replace("\r", " ").replace("\n", " ").replace("\t", "    ")
    value = _ILLEGAL_XML.sub("", value)
    return value.replace("\u00a0", " ")


def word_font(pdf_font: str) -> str:
    name = _SUBSET_PREFIX.sub("", pdf_font or "")
    for pattern, family in _FONT_RULES:
        if pattern.search(name):
            return family
    # Keep a readable original family when it looks like a real font name.
    candidate = re.split(r"[-,]", name, maxsplit=1)[0].strip()
    if candidate and len(candidate) <= 40 and re.fullmatch(r"[A-Za-z0-9 ._]+", candidate):
        return candidate
    return "Arial"


def _color_hex(value: object) -> str:
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "000000"
    if number < 0 or number > 0xFFFFFF:
        return "000000"
    return f"{number:06X}"


def _is_bold(font_name: str, flags: int) -> bool:
    lowered = font_name.lower()
    return bool(flags & 16) or "bold" in lowered or "black" in lowered or "heavy" in lowered


def _is_italic(font_name: str, flags: int) -> bool:
    lowered = font_name.lower()
    return bool(flags & 2) or "italic" in lowered or "oblique" in lowered


def _invisible_boxes(page: pymupdf.Page) -> list[pymupdf.Rect]:
    """Bounding boxes of text drawn with render mode 3 or zero opacity.

    OCR layers use invisible text over a scan. Emitting that text as visible
    Word text would duplicate the scanned page.
    """
    boxes: list[pymupdf.Rect] = []
    try:
        trace = page.get_texttrace()
    except Exception:
        return boxes
    for span in trace:
        if span.get("type") != 3 and float(span.get("opacity", 1.0)) > 0.01:
            continue
        bbox = span.get("bbox")
        if bbox:
            boxes.append(pymupdf.Rect(bbox))
    return boxes


def _inside_any(rect: pymupdf.Rect, boxes: list[pymupdf.Rect]) -> bool:
    center = pymupdf.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
    for box in boxes:
        if box.contains(center):
            return True
    return False


def _collect_text(page: pymupdf.Page, rotation: pymupdf.Matrix) -> tuple[list[TextLine], list[pymupdf.Rect]]:
    lines: list[TextLine] = []
    redactions: list[pymupdf.Rect] = []
    invisible = _invisible_boxes(page)
    try:
        payload = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP)
    except Exception:
        return lines, redactions

    for block in payload.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            direction = line.get("dir") or (1.0, 0.0)
            if abs(float(direction[1])) > 0.02:
                # Vertical or rotated text stays in the vector layer; moving it
                # into a horizontal Word frame would be worse than rasterizing.
                continue
            raw_bbox = pymupdf.Rect(line.get("bbox") or (0, 0, 0, 0))
            if raw_bbox.is_empty:
                continue
            redactions.append(pymupdf.Rect(
                raw_bbox.x0 - 1.0, raw_bbox.y0 - 1.0,
                raw_bbox.x1 + 1.0, raw_bbox.y1 + 1.0,
            ))

            spans: list[tuple[pymupdf.Rect, dict]] = []
            for span in line.get("spans", []):
                text = _clean_text(span.get("text") or "")
                if not text.strip():
                    continue
                bbox = pymupdf.Rect(span.get("bbox") or (0, 0, 0, 0))
                if _inside_any(bbox, invisible):
                    continue
                spans.append((bbox, span))
            if not spans:
                continue

            dominant = max(spans, key=lambda item: float(item[1].get("size") or 0))
            baseline_raw = float((dominant[1].get("origin") or (0, dominant[0].y1))[1])
            baseline_point = pymupdf.Point(spans[0][0].x0, baseline_raw) * rotation
            line_size = max(4.0, float(dominant[1].get("size") or 10.0))

            runs: list[TextRun] = []
            for bbox, span in spans:
                font_name = str(span.get("font") or "")
                size = max(4.0, float(span.get("size") or line_size))
                runs.append(TextRun(
                    text=_clean_text(span.get("text") or ""),
                    font=word_font(font_name),
                    size=size,
                    bold=_is_bold(font_name, int(span.get("flags") or 0)),
                    italic=_is_italic(font_name, int(span.get("flags") or 0)),
                    color=_color_hex(span.get("color")),
                ))
            if not runs:
                continue
            display_bbox = raw_bbox * rotation
            lines.append(TextLine(
                x=max(0.0, baseline_point.x),
                baseline=max(0.0, baseline_point.y),
                size=line_size,
                height=max(2.0, raw_bbox.height),
                width=max(1.0, display_bbox.width),
                runs=runs,
            ))

    lines.sort(key=lambda item: (round(item.baseline, 1), item.x))
    return lines, redactions


def _apply_redactions(page: pymupdf.Page, boxes: list[pymupdf.Rect], remove_images: bool) -> None:
    if not boxes:
        return
    for rect in boxes:
        page.add_redact_annot(rect)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_REMOVE if remove_images else pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )


def _image_bytes(doc: pymupdf.Document, xref: int) -> tuple[bytes, str] | None:
    try:
        payload = doc.extract_image(xref)
    except Exception:
        return None
    data = payload.get("image") or b""
    if not data:
        return None
    extension = str(payload.get("ext") or "").lower()
    smask = int(payload.get("smask") or 0)
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        return None

    if smask:
        try:
            mask_payload = doc.extract_image(smask)
            mask = Image.open(io.BytesIO(mask_payload.get("image") or b"")).convert("L")
            image = image.convert("RGBA")
            if mask.size != image.size:
                mask = mask.resize(image.size, Image.Resampling.LANCZOS)
            image.putalpha(mask)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG", optimize=True)
            return buffer.getvalue(), "png"
        except Exception:
            pass

    if image.mode in ("CMYK", "YCbCr", "I", "F", "LA", "PA") or extension not in ("png", "jpeg", "jpg"):
        try:
            image = image.convert("RGB")
        except Exception:
            return None
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=92)
        return buffer.getvalue(), "jpeg"
    return data, "jpeg" if extension == "jpg" else extension


def _raster_picture(page: pymupdf.Page, rect: pymupdf.Rect) -> tuple[bytes, str] | None:
    try:
        pixmap = page.get_pixmap(clip=rect, dpi=RASTER_DPI, alpha=False)
    except Exception:
        return None
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue(), "png"


def _picture_key(xref: int, data: bytes) -> str:
    if xref:
        return f"xref-{xref}"
    return "sha-" + hashlib.sha1(data).hexdigest()


def _collect_pictures(
    doc: pymupdf.Document,
    page: pymupdf.Page,
    rotation: pymupdf.Matrix,
    raster_source: pymupdf.Page | None,
) -> tuple[list[Picture], list[pymupdf.Rect]]:
    pictures: list[Picture] = []
    boxes: list[pymupdf.Rect] = []
    try:
        infos = page.get_image_info(xrefs=True)
    except Exception:
        return pictures, boxes

    for info in infos:
        raw_bbox = pymupdf.Rect(info.get("bbox") or (0, 0, 0, 0))
        if raw_bbox.is_empty:
            continue
        boxes.append(raw_bbox)
        display_bbox = raw_bbox * rotation
        xref = int(info.get("xref") or 0)
        transform = info.get("transform") or (1, 0, 0, 1, 0, 0)
        simple = (
            abs(float(transform[1])) < 0.01
            and abs(float(transform[2])) < 0.01
            and float(transform[0]) > 0
            and float(transform[3]) > 0
        )
        extracted = _image_bytes(doc, xref) if xref and simple else None
        if extracted is None:
            if raster_source is None:
                continue
            extracted = _raster_picture(raster_source, display_bbox)
            if extracted is None:
                continue
        data, extension = extracted
        if not data:
            continue
        pictures.append(Picture(
            key=_picture_key(xref, data),
            data=data,
            extension=extension,
            x=max(0.0, display_bbox.x0),
            y=max(0.0, display_bbox.y0),
            width=max(1.0, display_bbox.width),
            height=max(1.0, display_bbox.height),
        ))
    return pictures, boxes


def _overlay_image(page: pymupdf.Page) -> tuple[bytes | None, bool]:
    """Render the remaining vector artwork as a transparent PNG.

    Returns (png_bytes, is_plain_white). Plain white layers are skipped because
    the Word page is already white.
    """
    try:
        pixmap = page.get_pixmap(dpi=VECTOR_DPI, alpha=True)
    except Exception:
        return None, False
    if not pixmap.width or not pixmap.height:
        return None, False
    image = Image.frombytes("RGBA", (pixmap.width, pixmap.height), pixmap.samples)
    alpha = image.getchannel("A")
    if alpha.getextrema()[1] == 0:
        return None, False
    # A white page rectangle needs no separate layer.
    opaque = image.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    bbox = opaque.getbbox()
    if bbox is None:
        return None, False
    crop = image.crop(bbox)
    mask = crop.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    flattened = Image.new("RGB", crop.size, (255, 255, 255))
    flattened.paste(crop.convert("RGB"), mask=mask)
    extrema = flattened.getextrema()
    if all(low >= 250 for low, _high in extrema):
        return None, True
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    data = buffer.getvalue()
    if len(data) > MAX_VECTOR_BYTES:
        try:
            pixmap = page.get_pixmap(dpi=150, alpha=True)
            image = Image.frombytes("RGBA", (pixmap.width, pixmap.height), pixmap.samples)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG", optimize=True)
            data = buffer.getvalue()
        except Exception:
            pass
    return data, False


def _page_layout(doc: pymupdf.Document, page: pymupdf.Page) -> PageLayout:
    display = page.rect
    layout = PageLayout(width=max(1.0, display.width), height=max(1.0, display.height))

    if page.rotation % 360:
        # Rotated pages are preserved as a single background image. Rebuilding
        # them with horizontal Word frames would rotate the text incorrectly.
        try:
            pixmap = page.get_pixmap(dpi=150, alpha=False)
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=88)
            layout.pictures.append(Picture(
                key=f"page-raster-{page.number}",
                data=buffer.getvalue(),
                extension="jpeg",
                x=0.0,
                y=0.0,
                width=layout.width,
                height=layout.height,
            ))
            layout.rasterized = True
        except Exception:
            pass
        return layout

    lines, text_boxes = _collect_text(page, page.rotation_matrix)
    layout.lines = lines

    # Text is removed before rendering the vector layer, so the layer contains
    # only logos, rules, charts, highlights and other non-text artwork.
    _apply_redactions(page, text_boxes, remove_images=False)

    pictures, image_boxes = _collect_pictures(doc, page, page.rotation_matrix, page)
    layout.pictures.extend(pictures)

    _apply_redactions(page, image_boxes, remove_images=True)
    overlay, _ = _overlay_image(page)
    layout.overlay = overlay
    return layout


def _twips(value: float) -> int:
    return max(0, int(round(value * TWIPS_PER_POINT)))


def _emu(value: float) -> int:
    return max(0, int(round(value * EMU_PER_POINT)))


def _run_xml(run: TextRun) -> str:
    properties = [
        f'<w:rFonts w:ascii="{xml_escape(run.font)}" w:hAnsi="{xml_escape(run.font)}" '
        f'w:eastAsia="{xml_escape(run.font)}" w:cs="{xml_escape(run.font)}"/>',
    ]
    if run.bold:
        properties.append("<w:b/><w:bCs/>")
    if run.italic:
        properties.append("<w:i/><w:iCs/>")
    if run.color.upper() != "000000":
        properties.append(f'<w:color w:val="{run.color}"/>')
    half_points = max(2, int(round(run.size * 2)))
    properties.append(f'<w:sz w:val="{half_points}"/><w:szCs w:val="{half_points}"/>')
    text = xml_escape(run.text)
    return f'<w:r><w:rPr>{"".join(properties)}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'


def _frame_paragraph(line: TextLine, page_width: float) -> str:
    top = line.baseline - line.size * BASELINE_RATIO
    # Use the remaining page width for ordinary lines, but never let a short
    # right-aligned line wrap inside a narrow frame near the page edge.
    width = max(8.0, page_width - line.x - 0.5, line.width * 1.12 + 4.0)
    height = max(6.0, line.size * (BASELINE_RATIO + 0.32) + 2.0)
    frame = (
        f'<w:framePr w:w="{_twips(width)}" w:h="{_twips(height)}" '
        f'w:x="{_twips(line.x)}" w:y="{_twips(max(0.0, top))}" '
        'w:hAnchor="page" w:vAnchor="page" w:wrap="none" w:hRule="atLeast"/>'
    )
    paragraph = (
        '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
        '<w:ind w:left="0" w:right="0" w:firstLine="0"/>'
        '<w:jc w:val="left"/>'
    )
    runs = "".join(_run_xml(run) for run in line.runs)
    return f"<w:p><w:pPr>{frame}{paragraph}</w:pPr>{runs}</w:p>"


def _picture_anchor(picture: Picture, rel_id: str, index: int) -> str:
    cx = _emu(picture.width)
    cy = _emu(picture.height)
    return (
        '<w:r><w:drawing>'
        f'<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" '
        f'relativeHeight="{index + 1}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">'
        '<wp:simplePos x="0" y="0"/>'
        f'<wp:positionH relativeFrom="page"><wp:posOffset>{_emu(picture.x)}</wp:posOffset></wp:positionH>'
        f'<wp:positionV relativeFrom="page"><wp:posOffset>{_emu(picture.y)}</wp:posOffset></wp:positionV>'
        f'<wp:extent cx="{cx}" cy="{cy}"/>'
        '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>'
        f'<wp:docPr id="{index + 1}" name="Picture {index + 1}"/>'
        '<wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic><pic:nvPicPr>'
        f'<pic:cNvPr id="{index + 1}" name="Picture {index + 1}"/>'
        '<pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
    )


def _anchors_paragraph(anchors: list[str]) -> str:
    if not anchors:
        return ""
    return (
        '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
        '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>'
        + "".join(anchors)
        + "</w:p>"
    )


def _section_properties(width: float, height: float) -> str:
    return (
        "<w:sectPr>"
        f'<w:pgSz w:w="{_twips(width)}" w:h="{_twips(height)}"/>'
        '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" '
        'w:header="0" w:footer="0" w:gutter="0"/>'
        '<w:cols w:space="0"/></w:sectPr>'
    )


def _section_break(width: float, height: float) -> str:
    return (
        '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
        '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>'
        + _section_properties(width, height)
        + "</w:pPr></w:p>"
    )


def _document_xml(
    pages: list[PageLayout],
    relationships: dict[str, str],
) -> str:
    body: list[str] = []
    z_index = 0
    for page_index, page in enumerate(pages):
        anchors: list[str] = []
        if page.overlay is not None:
            overlay_key = f"overlay-{page_index}"
            overlay = Picture(
                key=overlay_key,
                data=page.overlay,
                extension="png",
                x=0.0,
                y=0.0,
                width=page.width,
                height=page.height,
            )
            z_index += 1
            anchors.append(_picture_anchor(overlay, relationships[overlay_key], z_index - 1))
        for picture in page.pictures:
            z_index += 1
            anchors.append(_picture_anchor(picture, relationships[picture.key], z_index - 1))
        body.append(_anchors_paragraph(anchors))
        for line in page.lines:
            body.append(_frame_paragraph(line, page.width))
        if page_index < len(pages) - 1:
            body.append(_section_break(page.width, page.height))
    last = pages[-1]
    body.append(_section_properties(last.width, last.height))
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f"<w:body>{''.join(body)}</w:body></w:document>"
    )
    return document


def _styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:docDefaults><w:rPrDefault><w:rPr>'
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>'
        '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/>'
        '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>'
        '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
        '</w:pPr></w:pPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/><w:qFormat/></w:style>'
        '</w:styles>'
    )


def _settings_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:zoom w:percent="100"/>'
        '<w:defaultTabStop w:val="720"/>'
        '<w:compat><w:compatSetting w:name="compatibilityMode" '
        'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
        '</w:settings>'
    )


def _package(
    document: str,
    media: list[tuple[str, bytes]],
    title: str,
) -> bytes:
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        '<Default Extension="jpeg" ContentType="image/jpeg"/>'
        '<Default Extension="jpg" ContentType="image/jpeg"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        "</Types>"
    )
    package_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    )
    relationship_parts = [
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    ]
    media_parts: list[tuple[str, bytes]] = []
    seen: set[str] = set()
    for name, data in media:
        if name in seen:
            continue
        seen.add(name)
        relationship_parts.append(
            f'<Relationship Id="rId-{name}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            f'Target="media/{name}"/>'
        )
        media_parts.append((f"word/media/{name}", data))
    document_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(relationship_parts)
        + "</Relationships>"
    )
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    core = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<dc:title>{xml_escape(title)}</dc:title><dc:creator>APOS</dc:creator>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>'
        "</cp:coreProperties>"
    )
    app = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>APOS</Application></Properties>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", package_rels)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/_rels/document.xml.rels", document_rels)
        archive.writestr("word/styles.xml", _styles_xml())
        archive.writestr("word/settings.xml", _settings_xml())
        archive.writestr("docProps/core.xml", core)
        archive.writestr("docProps/app.xml", app)
        for name, data in media_parts:
            archive.writestr(name, data)
    return buffer.getvalue()


def convert_pdf_to_layout_docx(
    data: bytes,
    *,
    page_indexes: list[int] | None = None,
    title: str = "Converted document",
) -> tuple[bytes, dict[str, int]]:
    """Convert a PDF into a position-preserving DOCX.

    ``page_indexes`` are zero-based. Returns the DOCX bytes and a small stats
    dictionary used by the API response and the UI.
    """
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # pragma: no cover - defensive
        raise ValueError("that file does not look like a valid PDF") from exc
    if document.needs_pass:
        document.close()
        raise ValueError("this PDF is password-protected — unlock it first")

    selected = list(range(document.page_count)) if page_indexes is None else list(page_indexes)
    if not selected:
        document.close()
        raise ValueError("no pages selected")
    if len(selected) > MAX_PAGES:
        document.close()
        raise ValueError(f"exact layout conversion supports up to {MAX_PAGES} pages per run")
    if any(index < 0 or index >= document.page_count for index in selected):
        document.close()
        raise ValueError("the selected page range is outside this document")

    layouts: list[PageLayout] = []
    media_by_key: dict[str, tuple[str, bytes]] = {}
    relationships: dict[str, str] = {}
    media_counter = 0
    text_lines = 0
    raster_pages = 0
    overlay_pages = 0

    try:
        for page_index in selected:
            page = document.load_page(page_index)
            layout = _page_layout(document, page)
            if layout.rasterized:
                raster_pages += 1
            if layout.overlay is not None:
                overlay_pages += 1
            text_lines += len(layout.lines)
            if text_lines > MAX_TEXT_LINES:
                raise ValueError(
                    f"this document has more than {MAX_TEXT_LINES} text lines; "
                    "convert a smaller page range or use the flowing Word mode"
                )
            for picture in layout.pictures:
                if picture.key not in media_by_key:
                    media_counter += 1
                    extension = "jpeg" if picture.extension in ("jpeg", "jpg") else "png"
                    name = f"image{media_counter}.{extension}"
                    media_by_key[picture.key] = (name, picture.data)
                    relationships[picture.key] = f"rId-{name}"
            if layout.overlay is not None:
                overlay_key = f"overlay-{page_index}"
                name = f"overlay{page_index + 1}.png"
                media_by_key[overlay_key] = (name, layout.overlay)
                relationships[overlay_key] = f"rId-{name}"
            layouts.append(layout)
    finally:
        document.close()

    media = list(media_by_key.values())
    document_xml = _document_xml(layouts, relationships)
    package = _package(document_xml, media, title)
    if len(package) > MAX_DOCX_BYTES:
        raise ValueError("the generated Word file is too large; convert fewer pages")
    stats = {
        "pages": len(layouts),
        "text_lines": text_lines,
        "pictures": sum(len(layout.pictures) for layout in layouts),
        "overlay_pages": overlay_pages,
        "raster_pages": raster_pages,
    }
    return package, stats
