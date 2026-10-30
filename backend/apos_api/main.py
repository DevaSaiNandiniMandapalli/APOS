from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="APOS API", version="0.1.0", docs_url="/api/docs", redoc_url=None)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@app.get("/api/v1/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    """Report API availability without exposing environment details."""
    return HealthResponse(status="ok", service="apos-api", version="0.1.0")
