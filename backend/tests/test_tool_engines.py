import asyncio
import io
import zipfile

import httpx
import pypdf

from apos_api.main import app


def text_pdf(text: str = "Contact alex@example.com or +1 555 123 4567") -> bytes:
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(400, 500))
    pdf.setFont("Helvetica", 12)
    pdf.drawString(40, 420, text)
    pdf.showPage()
    pdf.drawString(40, 420, "Second page")
    pdf.save()
    return buffer.getvalue()


async def run(name: str, files: list[tuple], data: dict | None = None) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(f"/api/v1/tools/{name}", files=files, data=data or {})


def post(name: str, files: list[tuple], data: dict | None = None) -> httpx.Response:
    return asyncio.run(run(name, files, data))


def test_pdf_to_images_returns_valid_pngs_in_a_zip() -> None:
    response = post("pdf_to_images", [("files", ("text.pdf", text_pdf(), "application/pdf"))], {"format": "png", "dpi": "72"})
    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()
    assert len(names) == 2
    assert all(archive.read(name).startswith(b"\x89PNG") for name in names)


def test_pdf_to_word_produces_a_real_docx() -> None:
    response = post("pdf_to_word", [("files", ("text.pdf", text_pdf(), "application/pdf"))])
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"PK")
    import docx

    document = docx.Document(io.BytesIO(response.content))
    assert any("alex@example.com" in paragraph.text for paragraph in document.paragraphs)


def test_pdf_to_word_honours_a_page_range() -> None:
    response = post("pdf_to_word", [("files", ("text.pdf", text_pdf(), "application/pdf"))], {"pages": "2"})
    assert response.status_code == 200, response.text
    import docx

    document = docx.Document(io.BytesIO(response.content))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "Second page" in text
    assert "alex@example.com" not in text


def picture_pdf() -> bytes:
    from PIL import Image
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    image = Image.new("RGB", (80, 50), (220, 40, 40))
    image_buffer = io.BytesIO()
    image.save(image_buffer, format="PNG")
    image_buffer.seek(0)

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(400, 500))
    pdf.setFont("Helvetica", 12)
    pdf.drawString(50, 400, "Anchored text")
    pdf.drawImage(ImageReader(image_buffer), 200, 100, width=80, height=50)
    pdf.save()
    return buffer.getvalue()


def test_pdf_to_word_exact_layout_keeps_picture_coordinates() -> None:
    response = post(
        "pdf_to_word",
        [("files", ("layout.pdf", picture_pdf(), "application/pdf"))],
        {"mode": "layout"},
    )
    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    document = archive.read("word/document.xml").decode("utf-8")

    assert '<w:pgSz w:w="8000" w:h="10000"/>' in document
    assert "<w:framePr" in document
    assert 'w:x="1000"' in document
    assert 'w:hAnchor="page"' in document
    assert 'w:vAnchor="page"' in document
    assert "<wp:anchor" in document
    assert 'relativeFrom="page"' in document
    # The picture sits at PDF x=200, y=100 with a 80x50 point box. PyMuPDF
    # reports it from the top edge, so y=350 in display coordinates.
    assert f"<wp:posOffset>{200 * 12700}</wp:posOffset>" in document
    assert f"<wp:posOffset>{350 * 12700}</wp:posOffset>" in document
    assert f'cx="{80 * 12700}" cy="{50 * 12700}"' in document
    assert any(name.startswith("word/media/") for name in archive.namelist())


def test_pdf_to_word_flowing_mode_still_produces_editable_paragraphs() -> None:
    response = post(
        "pdf_to_word",
        [("files", ("text.pdf", text_pdf(), "application/pdf"))],
        {"mode": "flow"},
    )
    assert response.status_code == 200, response.text
    import docx

    document = docx.Document(io.BytesIO(response.content))
    assert any("alex@example.com" in paragraph.text for paragraph in document.paragraphs)


def test_pdf_to_excel_and_powerpoint_open_with_their_libraries() -> None:
    excel = post("pdf_to_excel", [("files", ("text.pdf", text_pdf(), "application/pdf"))])
    assert excel.status_code == 200, excel.text
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(excel.content))
    assert workbook.sheetnames == ["Page 1", "Page 2"]

    slides = post("pdf_to_powerpoint", [("files", ("text.pdf", text_pdf(), "application/pdf"))])
    assert slides.status_code == 200, slides.text
    assert slides.content.startswith(b"PK")
    from pptx import Presentation

    deck = Presentation(io.BytesIO(slides.content))
    assert len(deck.slides) == 2


def test_crop_changes_page_geometry() -> None:
    response = post("crop", [("files", ("text.pdf", text_pdf(), "application/pdf"))], {"top": 10, "right": 10, "bottom": 10, "left": 10})
    assert response.status_code == 200, response.text
    page = pypdf.PdfReader(io.BytesIO(response.content)).pages[0]
    assert float(page.mediabox.width) < 400
    assert float(page.mediabox.height) < 500


def test_compare_reports_no_differences_for_identical_files() -> None:
    fixture = text_pdf()
    response = post("compare", [("files", ("a.pdf", fixture, "application/pdf")), ("files", ("b.pdf", fixture, "application/pdf"))])
    assert response.status_code == 200, response.text
    report = response.content.decode()
    assert "no differences found" in report
    assert "Comparing" in report


def test_auto_redact_removes_the_detected_text() -> None:
    response = post("auto_redact", [("files", ("sensitive.pdf", text_pdf(), "application/pdf"))], {"emails": "true", "phones": "true"})
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF-")
    reader = pypdf.PdfReader(io.BytesIO(response.content))
    extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "alex@example.com" not in extracted
    assert "+1 555 123 4567" not in extracted


def test_pdf_to_excel_writes_untrusted_pdf_text_as_text_not_formulas() -> None:
    response = post(
        "pdf_to_excel",
        [("files", ("formula.pdf", text_pdf('=HYPERLINK("https://example.com","Click")'), "application/pdf"))],
    )
    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    sheet = archive.read("xl/worksheets/sheet1.xml").decode()
    assert "<f>" not in sheet
    assert "HYPERLINK" in sheet
    assert 't="inlineStr"' in sheet or 't="s"' in sheet or "<is>" in sheet


def test_self_signed_pades_signature_can_be_verified() -> None:
    signed = post("sign", [("files", ("contract.pdf", text_pdf(), "application/pdf"))], {
        "name": "APOS Test Signer",
        "organization": "APOS",
        "reason": "Verification test",
        "visible": "false",
    })
    assert signed.status_code == 200, signed.text
    assert signed.content.startswith(b"%PDF-")
    verified = post("verify_signatures", [("files", ("signed.pdf", signed.content, "application/pdf"))])
    assert verified.status_code == 200, verified.text
    report = verified.content.decode()
    assert "digital signatures" in report.lower() or "signature report" in report.lower()
    assert "intact (document unmodified): yes" in report
    assert "cryptographically valid:      yes" in report
