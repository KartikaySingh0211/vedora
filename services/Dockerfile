# ==============================================================================
# Vedora Backend API & FFmpeg Transcoder Worker - Production Dockerfile
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build & Compile NestJS Application
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install native build tools required for native C++ addons (argon2, etc.)
RUN apk add --no-cache python3 make g++

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy application configuration and source code
COPY tsconfig*.json ./
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src

# Build NestJS application bundle
RUN npm run build

# Prune devDependencies to keep only production runtime dependencies
RUN npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Install system FFmpeg, FFprobe, and curl for container healthchecks
RUN apk add --no-cache ffmpeg curl

ENV NODE_ENV=production
ENV PORT=8080
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

# Copy built application and production dependencies with non-root ownership
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/drizzle ./drizzle
COPY --chown=node:node --from=builder /app/drizzle.config.ts ./
COPY --chown=node:node --from=builder /app/tsconfig.json ./

# Create local storage and temporary transcoding job directories
RUN mkdir -p /app/storage_local/chunks /app/storage_local/objects /tmp/vedora-jobs && \
    chown -R node:node /app/storage_local /tmp/vedora-jobs

USER node

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://127.0.0.1:8080/api/v1/health || exit 1

CMD ["node", "dist/main"]
