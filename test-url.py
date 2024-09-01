import os
import requests
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables from .env file
load_dotenv()

# Define the vars for the app
SHLINK_API_TOKEN = os.getenv("SHLINK_API_TOKEN")
SHLINK_URL = os.getenv("SHLINK_URL")

def shorten_url(long_url, type, name=None):
    """
    Shorten a URL using Shlink API.
    
    Parameters:
        long_url (str): The URL to be shortened.
        type (str): The type of the URL (e.g., 'recovery', 'invite').
        name (str, optional): The custom name for the shortened URL. Defaults to 'type-yyyymmddHHMMSS'.
    
    Returns:
        str: The shortened URL or the original URL if the API key is not set.
    """

    # Check if API key and Shlink URL are properly set
    if not SHLINK_API_TOKEN or SHLINK_API_TOKEN == "your_api_token_here" or not SHLINK_URL:
        print("Shlink API token or URL not set. Returning the original URL.")
        return long_url

    # Default the name if not provided
    if not name:
        name = f"{type}-{datetime.now().strftime('%Y%m%d%H%M%S')}"

    # Set up headers for the API request
    headers = {
        'X-Api-Key': SHLINK_API_TOKEN,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }

    # Set up payload for the API request
    payload = {
        'longUrl': long_url,
        'customSlug': name,
        'findIfExists': True  # Optional: reuse an existing short URL if the long URL was previously shortened
    }

    try:
        # Make the request to Shlink API to shorten the URL
        response = requests.post(SHLINK_URL, json=payload, headers=headers)

        # Check if the request was successful
        if response.status_code == 201 or response.status_code == 200:
            response_data = response.json()
            short_url = response_data.get('shortUrl')  # Ensure 'shortUrl' is in the response
            if short_url:
                return short_url
            else:
                # Handle case where 'shortUrl' is not in the response
                print('Error: The API response does not contain a "shortUrl" field.')
                return long_url
        else:
            # Handle error
            print(f'Error: {response.status_code}')
            print(response.json())
            return long_url
    except requests.exceptions.RequestException as e:
        # Handle any requests exceptions (network issues, etc.)
        print(f'Exception: {e}')
        return long_url
    except ValueError as e:
        # Handle JSON decode error or any other value error
        print(f'ValueError: {e}')
        return long_url

if __name__ == "__main__":
    # Test URL to shorten
    long_url = "https://www.example.com/long-url-to-shorten"
    type_of_link = "test"
    
    # Shorten the URL without providing a custom name
    shortened_url = shorten_url(long_url, type_of_link)
    
    # Print the result
    print(f"Original URL: {long_url}")
    print(f"Shortened URL: {shortened_url}")

    # Shorten the URL with a custom name
    custom_name = "custom-name"
    shortened_url_with_name = shorten_url(long_url, type_of_link, custom_name)
    
    # Print the result
    print(f"Original URL: {long_url}")
    print(f"Shortened URL with custom name: {shortened_url_with_name}")