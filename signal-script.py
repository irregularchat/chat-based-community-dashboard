import os
import time
import requests
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

signal_service_url = os.getenv("SIGNAL_SERVICE_URL")
signal_phone_number = os.getenv("SIGNAL_PHONE_NUMBER")
group_id = "<YOUR_GROUP_ID>"

def fetch_messages():
    url = f"{signal_service_url}/v1/receive/{signal_phone_number}"
    response = requests.get(url)
    if response.status_code == 200:
        messages = response.json().get('messages', [])
        for message in messages:
            if 'groupInfo' in message and message['groupInfo']['groupId'] == group_id:
                print(f"New message in group {group_id}: {message['message']}")
                if message['type'] == 'groupUpdate':
                    print(f"Group update detected: {message['groupInfo']}")
    else:
        print(f"Failed to fetch messages: {response.status_code} {response.text}")

while True:
    fetch_messages()
    time.sleep(10)  # Poll every 10 seconds