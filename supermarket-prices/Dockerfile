FROM python:3.12-slim
ARG WITH_SCRAPER=0
WORKDIR /app
COPY pyproject.toml .
COPY smp ./smp
RUN pip install --no-cache-dir . \
 && if [ "$WITH_SCRAPER" = "1" ]; then pip install --no-cache-dir ".[scrape]" && (playwright install --with-deps chromium || true); fi
