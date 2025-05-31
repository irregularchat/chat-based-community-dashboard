#!/usr/bin/env python3
"""
Debug script to test pagination in the Authentik API.
This will show exactly what data.get('next') returns and why pagination might fail.
"""

import os
import sys
import requests
import json
from datetime import datetime

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.utils.config import Config

def test_pagination_debug():
    """Test pagination with detailed debugging."""
    
    print("=== Detailed Pagination Debug ===")
    
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    # Create a session for consistent requests
    session = requests.Session()
    
    params = {'page_size': 500}
    users = []
    url = f"{Config.AUTHENTIK_API_URL}/core/users/"
    page_count = 0
    
    print(f"Starting URL: {url}")
    print(f"Initial params: {params}")
    
    while url:
        page_count += 1
        print(f"\n--- PAGE {page_count} ---")
        print(f"Requesting URL: {url}")
        print(f"Params: {params}")
        
        try:
            start_time = datetime.now()
            response = session.get(url, headers=headers, params=params, timeout=60)
            duration = (datetime.now() - start_time).total_seconds()
            
            print(f"Response status: {response.status_code}")
            print(f"Response time: {duration:.2f}s")
            
            response.raise_for_status()
            data = response.json()
            
            # Debug the response structure
            print(f"Response keys: {list(data.keys())}")
            
            results = data.get('results', [])
            print(f"Results count: {len(results)}")
            
            # Check for pagination info in different locations
            next_url = data.get('next')
            previous_url = data.get('previous') 
            count = data.get('count')
            
            print(f"Direct total count: {count}")
            print(f"Direct next URL: {next_url}")
            print(f"Direct previous URL: {previous_url}")
            
            # NEW: Check the pagination field
            pagination = data.get('pagination')
            print(f"Pagination field: {pagination}")
            print(f"Pagination type: {type(pagination)}")
            
            if pagination and isinstance(pagination, dict):
                print("🔍 Pagination field contents:")
                for key, value in pagination.items():
                    print(f"  {key}: {value}")
                
                # Look for next URL in pagination
                pagination_next = pagination.get('next')
                pagination_count = pagination.get('count')
                
                print(f"Pagination next: {pagination_next}")
                print(f"Pagination count: {pagination_count}")
                
                if pagination_next:
                    print("✅ Found next URL in pagination field!")
                    next_url = pagination_next
                else:
                    print("❌ No next URL in pagination field")
            
            if next_url:
                print(f"Next URL type: {type(next_url)}")
                print(f"Next URL length: {len(next_url) if next_url else 0}")
            else:
                print("❌ Next URL is None/empty - pagination will stop!")
            
            # Add users to collection
            users.extend(results)
            
            # Set up for next iteration
            url = next_url
            params = {}  # Clear params after first request
            
            print(f"Next iteration URL: {url}")
            print(f"Total users so far: {len(users)}")
            
            # If we have no next URL, explain why we're stopping
            if not url:
                print(f"🛑 Stopping pagination: next URL is {url}")
                break
                
            # Safety check to prevent infinite loops in testing
            if page_count >= 3:
                print(f"🛑 Stopping after {page_count} pages for safety")
                break
                
        except Exception as e:
            print(f"❌ Error on page {page_count}: {e}")
            break
    
    print(f"\n=== Final Results ===")
    print(f"Total pages fetched: {page_count}")
    print(f"Total users collected: {len(users)}")
    
    if len(users) == 500:
        print("⚠️  Got exactly 500 users - likely indicates pagination stopped after page 1")
    
    return users

def test_direct_api_call():
    """Test a direct API call to see the raw response structure."""
    
    print("\n=== Direct API Response Test ===")
    
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    url = f"{Config.AUTHENTIK_API_URL}/core/users/"
    params = {'page_size': 10}  # Small page for testing
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        print(f"Raw response structure:")
        print(json.dumps({
            'count': data.get('count'),
            'next': data.get('next'),
            'previous': data.get('previous'),
            'results_count': len(data.get('results', []))
        }, indent=2))
        
        # NEW: Check pagination field
        pagination = data.get('pagination')
        if pagination:
            print(f"\nPagination field contents:")
            print(json.dumps(pagination, indent=2))
        
        # Check if next URL exists and what it looks like
        next_url = data.get('next')
        
        # Also check pagination.next
        if pagination and isinstance(pagination, dict):
            pagination_next = pagination.get('next')
            if pagination_next and not next_url:
                next_url = pagination_next
                print(f"Using next URL from pagination field: {next_url}")
        
        if next_url:
            print(f"\nNext URL found: {next_url}")
            
            # Test the next URL directly
            print("\nTesting next URL directly...")
            next_response = requests.get(next_url, headers=headers, timeout=30)
            next_response.raise_for_status()
            next_data = next_response.json()
            
            print(f"Next page results count: {len(next_data.get('results', []))}")
            
            # Check both locations for next
            direct_next = next_data.get('next')
            pagination_next = next_data.get('pagination', {}).get('next') if next_data.get('pagination') else None
            
            print(f"Next page direct 'next' URL: {direct_next}")
            print(f"Next page pagination 'next' URL: {pagination_next}")
        else:
            print("❌ No next URL found!")
            
    except Exception as e:
        print(f"❌ Error in direct API test: {e}")

if __name__ == "__main__":
    print("Authentik API Pagination Debug Tool")
    print("=" * 50)
    
    # Test 1: Direct API call with small page
    test_direct_api_call()
    
    # Test 2: Detailed pagination debugging
    test_pagination_debug() 