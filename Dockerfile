FROM mcr.microsoft.com/playwright/python:v1.47.0-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/storage/screenshots /app/storage/annotated && \
    chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

