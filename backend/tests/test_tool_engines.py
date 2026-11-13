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
