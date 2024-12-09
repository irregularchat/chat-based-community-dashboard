import requests
from utils.config import Config

def list_events_cached(api_url, headers):
    response = requests.get(f"{api_url}/events", headers=headers)
    response.raise_for_status()  # Raise an error for bad responses
    return response.json()