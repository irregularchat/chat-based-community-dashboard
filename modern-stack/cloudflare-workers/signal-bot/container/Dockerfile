# Dockerfile for Signal CLI Bot Container (Self-hosted)
# Uses pre-built dist folder for faster builds
#
# SECURITY: Container runs as non-root user 'node' (UID 1000)
# This limits damage from command injection or other vulnerabilities

# Stage 1: Install signal-cli
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

# Stage 2: Final runtime image
FROM node:20-slim

# Install base dependencies first (curl needed for Adoptium)
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    apt-transport-https \
    gnupg \
    sqlite3 \
    ffmpeg \
    python3 \
    python3-pip \
    git \
    clamav \
    clamav-daemon \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Adoptium Java 21 (signal-cli 0.13.22 requires Java 21)
RUN mkdir -p /etc/apt/keyrings \
    && wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor > /etc/apt/keyrings/adoptium.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y temurin-21-jre \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp and rclone
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && freshclam || true \
    && curl https://rclone.org/install.sh | bash

# Set Java environment variables
ENV JAVA_HOME=/usr/lib/jvm/temurin-21-jre-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# SECURITY: Create non-root user for running the application
# node:20-slim already has UID/GID 1000 (user 'node'), so we use that user
# and add it to the clamav group for virus scanning
RUN usermod -aG clamav node

WORKDIR /app

# Copy signal-cli from signal-cli stage
COPY --from=signal-cli /opt/signal-cli-* /opt/signal-cli/
RUN ln -sf /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli

# Copy pre-built application (built locally with npm run build)
COPY dist ./dist
COPY package*.json ./

# Copy configuration files
COPY config ./config

# Copy memes directory
COPY memes ./memes

# Install production dependencies only
RUN npm ci --only=production

# Copy sync and entrypoint scripts
COPY sync-signal-data.sh /app/sync-signal-data.sh
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/sync-signal-data.sh /app/entrypoint.sh

# Create directories with proper ownership (node user is UID 1000 in node:20-slim)
# /app/java-tmp is for Java/signal-cli temp files (separate from downloads mount)
RUN mkdir -p /app/signal-data /app/downloads /app/java-tmp \
    && chown -R node:node /app

# SECURITY: Fix ClamAV permissions so non-root user can use it
RUN mkdir -p /var/run/clamav /var/log/clamav \
    && chown -R clamav:clamav /var/run/clamav /var/log/clamav \
    && chmod 755 /var/run/clamav

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD curl -f http://localhost:8080/health || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV SIGNAL_CLI_CONFIG_DIR=/app/signal-data
# SECURITY: Tell Java to use writable temp directory (not /tmp which may be mounted)
ENV JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/app/java-tmp"

# SECURITY: Switch to non-root user (node user in node:20-slim is UID 1000)
USER node

# Use entrypoint script that handles R2 sync
ENTRYPOINT ["/app/entrypoint.sh"]
