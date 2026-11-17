FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci && npm run build
ENV NODE_ENV=production
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","3103"]
