FROM node:20-alpine
WORKDIR /app

# FFmpeg for streaming
RUN apk add --no-cache ffmpeg

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production \
    PORT=3001

EXPOSE 3001

CMD ["npm", "start"]

