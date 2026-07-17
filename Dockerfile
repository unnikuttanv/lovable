FROM python:3.12-slim

# Node is needed only for `vite build` when publishing (bundles, never executes app code)
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyserver/requirements.txt pyserver/
RUN pip install --no-cache-dir -r pyserver/requirements.txt

COPY runner/package*.json runner/
RUN npm ci --prefix runner

COPY pyserver pyserver
COPY runner runner
COPY client client

ENV PORT=3001
EXPOSE 3001
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "pyserver", "--host", "0.0.0.0", "--port", "3001"]
