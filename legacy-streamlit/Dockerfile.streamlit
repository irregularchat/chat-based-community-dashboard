# Use the official Python image as the base image
FROM python:3.11-slim

# Set environment variables for non-interactive installation
ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_NO_CACHE_DIR=1

# Set the working directory inside the container
WORKDIR /app

# Install system-level dependencies and clean up
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential gcc libssl-dev libffi-dev \
    libxml2-dev libxslt1-dev zlib1g-dev curl dos2unix \
    postgresql-client netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Copy the requirements.txt first to leverage Docker cache
COPY requirements.txt .

# Split pip commands and add verbose logging
RUN pip install --upgrade pip && \
    pip install --verbose -r requirements.txt

# Copy the entrypoint script first and set it up
COPY entrypoint.sh /app/
RUN dos2unix /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Copy the rest of the application code into the container
COPY . .

# Create a directory for data if it doesn't exist
RUN mkdir -p /app/app/data && chmod 777 /app/app/data

# Ensure the .env file is writable and load it if it exists
RUN touch /app/.env && chmod 666 /app/.env

# Install the package in development mode
RUN pip install -e .

# Set Python path
ENV PYTHONPATH=/app

# Set environment variable for Docker detection
ENV IN_DOCKER=true

# Use the entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]