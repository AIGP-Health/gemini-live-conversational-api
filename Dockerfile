# Single stage build for Cloud Run
FROM node:20-slim

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy all source files
COPY . .

# Build frontend (Vite)
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# Cloud Run provides PORT env var (default 8080)
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# Start the server
CMD ["node", "server.js"]
