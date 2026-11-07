# syntax=docker/dockerfile:1

# ---- web app: built once on the build machine's own architecture ----
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npx vite build --outDir /out/static --emptyOutDir

# ---- runtime ----
FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    EVALBENCH_DATA=/data
LABEL org.opencontainers.image.title="Evalbench" \
      org.opencontainers.image.description="Self-hosted LLM evaluation workbench" \
      org.opencontainers.image.source="https://github.com/gallowforge/evalbench" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY evalbench ./evalbench
COPY --from=web /out/static ./evalbench/static
RUN pip install . \
 && useradd --uid 1000 --create-home --shell /usr/sbin/nologin evalbench \
 && mkdir -p /data && chown evalbench:evalbench /data
USER evalbench
EXPOSE 8484
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8484/api/health', timeout=4)"
CMD ["evalbench", "serve"]
