FROM node:24-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY landing/package.json ./landing/package.json
RUN npm ci
COPY scripts/ifstruct/requirements.txt /tmp/ifstruct-requirements.txt
RUN python3 -m venv /opt/ifstruct && /opt/ifstruct/bin/pip install --no-cache-dir -r /tmp/ifstruct-requirements.txt
ENV IFSTRUCT_PYTHON=/opt/ifstruct/bin/python
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3103
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","3103"]
