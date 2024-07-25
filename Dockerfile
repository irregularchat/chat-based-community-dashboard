# Use the official Python image as the base image
FROM python:3.12-slim

# Set the working directory
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install the required packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container
COPY . .

# Command to run the Streamlit app using a shell to handle environment variable substitution
CMD ["sh", "-c", "streamlit run authentik-streamlit.py --server.port=${PORT} --server.enableCORS=false"]
