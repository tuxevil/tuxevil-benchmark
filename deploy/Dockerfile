FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY landing/package.json ./landing/package.json
RUN npm ci
COPY scripts/ifstruct/requirements.txt /tmp/ifstruct-requirements.txt
RUN python3 -m venv /opt/ifstruct && /opt/ifstruct/bin/pip install --no-cache-dir -r /tmp/ifstruct-requirements.txt
COPY scripts/math500/requirements.txt /tmp/math500-requirements.txt
RUN python3 -m venv /opt/math500 && /opt/math500/bin/pip install --no-cache-dir -r /tmp/math500-requirements.txt
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit
# npm retains Playwright through Next.js's optional peer dependency.
RUN rm -rf node_modules/@playwright/test node_modules/playwright node_modules/playwright-core \
    node_modules/.bin/playwright node_modules/.bin/playwright-core

FROM base AS runtime
ENV NODE_ENV=production
ENV IFSTRUCT_PYTHON=/opt/ifstruct/bin/python
ENV MATH500_PYTHON=/opt/math500/bin/python
COPY --from=build /opt/ifstruct /opt/ifstruct
COPY --from=build /opt/math500 /opt/math500
COPY --from=build /app /app
EXPOSE 3103
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","3103"]
