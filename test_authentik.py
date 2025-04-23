#!/usr/bin/env python3
import requests
from config import Config

# Setup headers
headers = {
    'Authorization': f'Bearer {Config.AUTHENTIK_API_TOKEN}',
    'Content-Type': 'application/json'
}

def test_api_connection():
    try:
        # Test the API connection
        response = requests.get(f"{Config.AUTHENTIK_API_URL}/core/users/", headers=headers)
        print(f"\nStatus Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            user_count = len(data.get('results', []))
            print(f"API connection successful! ✅")
            print(f"Found {user_count} users")
            print("\nFirst few users:")
            for user in data.get('results', [])[:3]:  # Show first 3 users
                print(f"- {user.get('username', 'N/A')} ({user.get('email', 'N/A')})")
        else:
            print("API connection failed! ❌")
            print(f"Error: {response.text}")
            
    except requests.exceptions.RequestException as e:
        print(f"Error connecting to API: {e}")

if __name__ == "__main__":
    print("Testing Authentik API connection...")
    test_api_connection()
