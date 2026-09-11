FROM node:20-bookworm-slim
WORKDIR /app

# Was node:20-bullseye-slim. bullseye-security's actual package files are gone from
# every live Debian mirror (deb.debian.org, security.debian.org) and not yet present
# in the permanent archive.debian.org archive either — verified directly, no apt-source
# patch fixes this, the suite is unreachable everywhere. bookworm's mirrors are fully
# live, so apt needs no special flags here. Bumps ffmpeg 4.3.9 -> 5.1.9 (bookworm's
# packaged version); the encode flags used in this codebase are long-stable across
# ffmpeg versions.
RUN apt-get update && \
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

