# Dockerfile for Signal CLI Bot Container (Cloudflare Native)
# Multi-stage build for optimal image size

# Stage 1: Build TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src
COPY types ./types

# Build TypeScript
RUN npm run build

# Stage 2: Install signal-cli
FROM debian:trixie-slim AS signal-cli

# Install dependencies for signal-cli
RUN apt-get update && apt-get install -y \
    openjdk-21-jre-headless \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Download and install signal-cli
ARG SIGNAL_CLI_VERSION=0.13.22
RUN wget https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz \
    && tar xf signal-cli-${SIGNAL_CLI_VERSION}.tar.gz -C /opt \
    && ln -sf /opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli /usr/local/bin/signal-cli \
    && rm signal-cli-${SIGNAL_CLI_VERSION}.tar.gz

# Stage 3: Final runtime image
FROM node:20-slim

# Install Java 21 from Adoptium and other dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    apt-transport-https \
    gnupg \
    sqlite3 \
    ffmpeg \
    python3 \
    python3-pip \
    && mkdir -p /etc/apt/keyrings \
    && wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | tee /etc/apt/keyrings/adoptium.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/adoptium.asc] https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y temurin-21-jre \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy signal-cli from signal-cli stage
COPY --from=signal-cli /opt/signal-cli-* /opt/signal-cli/
RUN ln -sf /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Copy configuration files
COPY config ./config

# Install production dependencies only
RUN npm ci --only=production

# Copy sync and entrypoint scripts
COPY sync-signal-data.sh /app/sync-signal-data.sh
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/sync-signal-data.sh /app/entrypoint.sh

# Create directory for signal-cli data
RUN mkdir -p /app/signal-data

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD curl -f http://localhost:8080/health || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV SIGNAL_CLI_CONFIG_DIR=/app/signal-data

# Use entrypoint script that handles R2 sync
ENTRYPOINT ["/app/entrypoint.sh"]
