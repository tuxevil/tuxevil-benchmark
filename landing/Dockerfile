# tuxevil Benchmark landing — static export built in Docker, served by nginx.
# NOTE: `next build` here must NOT run `landing:export`: the public snapshot
# is generated locally from the benchmark database and committed to
# landing/public/data/public-snapshot.json.

# --- Stage 1: static export ---
FROM node:20-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json ./
COPY landing/package.json landing/

# Install only the landing workspace (no native modules required)
RUN npm ci --workspace=landing --include-workspace-root=false

COPY landing landing
RUN npm run --prefix landing build

# --- Stage 2: serve statically via nginx ---
FROM nginx:1.27-alpine
EXPOSE 80
COPY landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/landing/out /usr/share/nginx/html
