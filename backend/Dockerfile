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

# Run migrations then start server
CMD ["sh", "-c", "npm run migrate && npm start"]

