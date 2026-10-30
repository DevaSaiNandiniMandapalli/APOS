import asyncio

import httpx

from apos_api.main import app


async def get(path: str) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.get(path)


def test_health_returns_service_status() -> None:
    response = asyncio.run(get("/api/v1/health"))

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "apos-api", "version": "0.1.0"}


def test_unreserved_processing_routes_are_absent() -> None:
    response = asyncio.run(get("/api/v1/batches"))

    assert response.status_code == 404


def test_health_asgi_contract() -> None:
    response = asyncio.run(get("/api/v1/health"))
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
