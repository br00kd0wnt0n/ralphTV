FROM node:20-bullseye-slim
WORKDIR /app

# -o Acquire::Check-Valid-Until=false: Debian bullseye-security's signed Release file
# has passed its freshness window (bullseye is past standard security support), so apt
# refuses it as "expired" even though the signature itself is still valid. This flag
# only skips the staleness check, not GPG verification. Fixes builds broken by this;
# does not change what gets installed. Longer-term: migrate off bullseye to bookworm.
RUN apt-get update -o Acquire::Check-Valid-Until=false && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production \
    PORT=3002

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3002/healthz || exit 1

CMD ["npm", "start"]

