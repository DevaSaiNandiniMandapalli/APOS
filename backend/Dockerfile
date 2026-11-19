FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        libreoffice \
        ghostscript \
        tesseract-ocr \
        tesseract-ocr-eng \
        ocrmypdf \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        shared-mime-info \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
COPY apos_api ./apos_api
COPY apos_processing ./apos_processing

RUN python -m pip install --upgrade pip \
    && python -m pip install ".[ocr,ai]"

RUN useradd --create-home --uid 10001 apos \
    && chown -R apos:apos /app
USER apos

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/api/v1/health" || exit 1

# Render and most PaaS hosts inject PORT; fall back to 8000 locally.
CMD ["sh", "-c", "uvicorn apos_api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
