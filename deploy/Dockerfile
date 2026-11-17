FROM node:24-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY landing/package.json ./landing/package.json
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3103
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","3103"]
