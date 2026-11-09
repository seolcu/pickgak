# 픽각 단일 이미지: 프론트엔드를 빌드해서 백엔드(FastAPI)가 함께 내보낸다.
# 데이터(SQLite DB, 받은 전장·등급 이미지)는 /data 볼륨에 둔다.

FROM node:24-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.24 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
COPY backend/data ./data
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 --home /data pickgak && mkdir -p /data && chown pickgak /data
USER pickgak
ENV PICKGAK_STATIC=/app/static \
    PICKGAK_DB=/data/pickgak.db \
    PICKGAK_CACHE=/data/cache \
    PATH=/app/.venv/bin:$PATH
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/config', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
