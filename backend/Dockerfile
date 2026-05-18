FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install system deps for docker CLI (needed by vuln_scan runner)
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock* ./

# Install dependencies (without dev)
RUN uv sync --frozen --no-dev

# Copy source
COPY agentos/ ./agentos/

# Create data directory
RUN mkdir -p /data /app/agents_config

CMD ["uv", "run", "uvicorn", "agentos.main:app", "--host", "0.0.0.0", "--port", "8000"]
