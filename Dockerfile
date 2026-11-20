FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# Install uv for fast, reproducible dependency installation
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml ./
RUN uv pip install --system --no-cache -r pyproject.toml

COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 8080

# Single worker per container instance is recommended for stateful WebSockets on Cloud Run;
# Cloud Run scales horizontally across instances automatically.
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080} --ws-ping-interval 25 --ws-ping-timeout 25"]
