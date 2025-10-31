FROM node:20-bullseye-slim
WORKDIR /app

# Install FFmpeg with libx264 support
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
