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
FROM debian:bookworm-slim AS signal-cli

# Install dependencies for signal-cli
RUN apt-get update && apt-get install -y \
    openjdk-17-jre-headless \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Download and install signal-cli
ARG SIGNAL_CLI_VERSION=0.13.9
RUN wget https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz \
    && tar xf signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz -C /opt \
    && ln -sf /opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli /usr/local/bin/signal-cli \
    && rm signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz

# Stage 3: Final runtime image
FROM node:20-slim

# Install Java (needed for signal-cli) and other dependencies
RUN apt-get update && apt-get install -y \
    openjdk-17-jre-headless \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy signal-cli from signal-cli stage
COPY --from=signal-cli /opt/signal-cli-* /opt/signal-cli/
RUN ln -sf /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production

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

# Run the bot
CMD ["node", "dist/index.js"]
