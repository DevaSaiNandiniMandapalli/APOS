import asyncio
import io
import json

import httpx
import pypdf

from apos_api.main import app


def pdf_bytes(pages: int = 1) -> bytes:
    writer = pypdf.PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=300, height=400)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


async def request(method: str, path: str, **kwargs) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


def test_registry_lists_processing_tools() -> None:
    response = asyncio.run(request("GET", "/api/v1/tools"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["processing_server"] is True
    names = {tool["name"] for tool in payload["tools"]}
    assert {"merge", "split", "crop", "pdf_to_pdfa", "sign", "verify_signatures", "auto_redact", "compare", "form_fill"}.issubset(names)
    assert all("available" in tool and "options" in tool for tool in payload["tools"])


def test_merge_returns_a_valid_pdf_with_download_headers() -> None:
    response = asyncio.run(request(
        "POST",
        "/api/v1/tools/merge",
        files=[
            ("files", ("a.pdf", pdf_bytes(), "application/pdf")),
            ("files", ("b.pdf", pdf_bytes(), "application/pdf")),
        ],
    ))
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF-")
    assert "attachment" in response.headers["content-disposition"]
    reopened = pypdf.PdfReader(io.BytesIO(response.content))
    assert len(reopened.pages) == 2


def test_rejects_a_pdf_extension_without_a_pdf_signature() -> None:
    response = asyncio.run(request(
        "POST",
        "/api/v1/tools/rotate",
        files=[("files", ("fake.pdf", b"not a pdf", "application/pdf"))],
    ))
    assert response.status_code == 400
    assert "PDF signature" in response.json()["error"]


def test_unknown_tool_and_removed_batch_route_stay_not_found() -> None:
    assert asyncio.run(request("POST", "/api/v1/tools/does_not_exist")).status_code == 404
    assert asyncio.run(request("GET", "/api/v1/batches")).status_code == 404


def test_supplied_client_aliases_are_available() -> None:
    assert asyncio.run(request("GET", "/healthz")).status_code == 200
    assert asyncio.run(request("GET", "/api/tools")).status_code == 200


def test_workflow_chains_merge_then_page_numbers() -> None:
    steps = [
        {"tool": "merge", "options": {}},
        {"tool": "page_numbers", "options": {"position": "bottom-center", "start": 1}},
    ]
    response = asyncio.run(request(
        "POST",
        "/api/v1/workflows/run",
        files=[
            ("files", ("one.pdf", pdf_bytes(2), "application/pdf")),
            ("files", ("two.pdf", pdf_bytes(), "application/pdf")),
        ],
        data={"steps": json.dumps(steps)},
    ))
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF-")
    assert len(pypdf.PdfReader(io.BytesIO(response.content)).pages) == 3


def test_form_field_inspection_returns_an_empty_list_for_a_plain_pdf() -> None:
    response = asyncio.run(request(
        "POST",
        "/api/v1/inspect/form-fields",
        files={"file": ("plain.pdf", pdf_bytes(), "application/pdf")},
    ))
    assert response.status_code == 200, response.text
    assert response.json() == {"fields": []}
