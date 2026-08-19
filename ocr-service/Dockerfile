FROM python:3.11-slim

# tesseract-ocr is a native dependency of pytesseract and won't come from pip.
RUN apt-get update && \
    apt-get install -y --no-install-recommends tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets $PORT; default to 8000 for local runs.
ENV PORT=8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
