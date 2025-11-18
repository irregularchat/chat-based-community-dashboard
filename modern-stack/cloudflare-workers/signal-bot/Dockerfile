# Dockerfile for Signal CLI Bot Container
# Based on bbernhard/signal-cli-rest-api but customized for Cloudflare Containers

FROM bbernhard/signal-cli-rest-api:latest

# Set environment variables
ENV MODE=json-rpc \
    PORT=8080 \
    SIGNAL_CLI_CONFIG_DIR=/home/.local/share/signal-cli

# Expose the port
EXPOSE 8080

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD curl -f http://localhost:8080/v1/health || exit 1

# The base image already has the entrypoint configured
# It will start the signal-cli-rest-api service
