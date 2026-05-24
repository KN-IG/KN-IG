FROM python:3.11-slim

WORKDIR /app

# Runtime deps only (tests/dev deps excluded).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8088

# API keys are provided at runtime via env (GEMINI_API_KEY / OPENAI_API_KEY);
# without them the server still returns valid template reports.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088"]
