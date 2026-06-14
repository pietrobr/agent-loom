FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
# Upgrade build tooling first (clears the wheel path-traversal CVE) then install.
RUN pip install --upgrade pip setuptools wheel \
    && pip install -r /app/requirements.txt

COPY backend/app /app/app
COPY config /app/config

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
