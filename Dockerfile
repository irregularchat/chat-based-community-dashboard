dockerfile
# Use the official Python image as a base
FROM python:3.9

# Install required packages
RUN pip install requests pyperclip

# Copy your script into the container
COPY authentik-creation-workflow.py /app/authentik-creation-workflow.py

# Set the working directory
WORKDIR /app

# Run the script when starting the container
CMD ["python", "authentik-creation-workflow.py"]
