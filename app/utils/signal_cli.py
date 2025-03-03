# /app/utils/signal_cli.py
import requests
import os

# Get the Signal API URL from environment variables
signal_api_url = os.environ.get("SIGNAL_API_URL")

# Send a message to a Signal group
def send_signal_group_message(group_id, message):
    endpoint = f"{signal_api_url}/send"
    payload = {
        "message": message,
        "number": os.environ.get("SIGNAL_PHONE_NUMBER"),
        "recipients": [f"group.{group_id}"]
    }
    response = requests.post(endpoint, json=payload)
    return response.status_code == 201  # Returns True if successful

# Send a direct message
def send_signal_direct_message(recipient_number, message):
    endpoint = f"{signal_api_url}/send"
    payload = {
        "message": message,
        "number": os.environ.get("SIGNAL_PHONE_NUMBER"),
        "recipients": [recipient_number]
    }
    response = requests.post(endpoint, json=payload)
    return response.status_code == 201