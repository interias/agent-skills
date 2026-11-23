FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN useradd --uid 10001 --no-create-home bruecke && mkdir /data && chown bruecke /data
USER bruecke
EXPOSE 8000
# HTTP, or HTTPS with BRUECKE_ZERT and BRUECKE_ZERT_SCHLUESSEL (#37): app/start.py
HEALTHCHECK --interval=30s --timeout=3s CMD python -m app.start --gesund
CMD ["python", "-m", "app.start"]
