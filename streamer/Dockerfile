FROM node:20-bullseye-slim
WORKDIR /app

# Install FFmpeg with libx264 support
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY assets ./assets

ENV NODE_ENV=production \
    PORT=3001 \
    LOGO_ENABLE=false \
    LOGO_PATH=/app/assets/logo.png \
    LOGO_SCALE=200 \
    LOGO_OPACITY=0.8

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

CMD ["npm", "start"]
