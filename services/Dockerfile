# ==============================================================================
# Vedora Backend API & FFmpeg Worker - Production Dockerfile
# ==============================================================================

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy application source code
COPY . .

# Build NestJS application bundle
RUN npm run build

# Prune dev dependencies for production
RUN npm prune --production

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Install system FFmpeg & FFprobe (CPU-based H.264/AAC encoding)
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production
ENV PORT=8080
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# Copy built artifacts and production node_modules from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create local storage directory
RUN mkdir -p /app/storage_local/chunks /app/storage_local/objects && \
    chown -R node:node /app

USER node

EXPOSE 8080

CMD ["node", "dist/main"]
