# Use the official Python image as the base image
FROM python:3.12-slim

# Set environment variables for non-interactive installation
ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_NO_CACHE_DIR=1

# Set the working directory inside the container
WORKDIR /app

# Install system-level dependencies and clean up
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential gcc libssl-dev libffi-dev \
    libxml2-dev libxslt1-dev zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy the requirements.txt first to leverage Docker cache
COPY requirements.txt .

# Split pip commands and add verbose logging
RUN pip install --upgrade pip && \
    pip install --verbose -r requirements.txt || (cat /root/.cache/pip/log/* && exit 1)

# Copy the rest of the application code into the container
COPY . .

# Create a directory for data if it doesn't exist
RUN mkdir -p /app/app/data && chmod 777 /app/app/data

# Ensure the .env file is writable
RUN touch /app/.env && chmod 666 /app/.env

# Expose the port Streamlit will run on (optional)
EXPOSE 8503

# Command to run the Streamlit app using a shell to handle environment variable substitution
CMD ["sh", "-c", "streamlit run /app/app/main.py --server.port=${PORT:-8503} --server.enableCORS=false"]