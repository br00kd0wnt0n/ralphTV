FROM node:20-alpine
WORKDIR /app

# Install deps first for better caching
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY . .

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# Run migrations then start server
CMD ["sh", "-c", "npm run migrate && npm start"]

