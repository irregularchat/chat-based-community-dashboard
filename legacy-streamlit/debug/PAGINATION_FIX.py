#!/usr/bin/env python3
"""
FIXED VERSION: list_users function with correct pagination handling.

The bug was that Authentik API returns pagination.next as a page NUMBER, not a URL.
The original code was looking for data.get('next') which was always None.

This fix constructs the URL from the base URL + page parameter.
"""

def list_users_fixed(auth_api_url, headers, search_term=None):
    """
    FIXED: List users from Authentik API with proper pagination.
    
    Bug fix: Use pagination.next (page number) instead of data.get('next') (URL).
    """
    import logging
    import time
    import requests
    
    logger = logging.getLogger(__name__)
    
    # Create a session for consistent requests
    session = requests.Session()
    
    try:
        # Start with page 1
        params = {'page_size': 500}  # Keep page size at 500 for reliability
        users = []
        base_url = f"{auth_api_url}/core/users/"
        current_page = 1
        max_retries = 3
        total_fetched = 0

        while True:
            logger.info(f"Fetching users page {current_page}...")
            
            # Construct URL for current page
            if current_page == 1:
                url = base_url
                request_params = params
            else:
                url = base_url
                request_params = {**params, 'page': current_page}
            
            # Try with retries for each page
            for retry in range(max_retries):
                try:
                    response = session.get(url, headers=headers, params=request_params, timeout=60)
                    response.raise_for_status()
                    data = response.json()
                    break  # Success, exit retry loop
                except Exception as e:
                    if retry < max_retries - 1:
                        logger.warning(f"Error fetching page {current_page}, retrying ({retry+1}/{max_retries}): {e}")
                        time.sleep(2)  # Wait before retrying
                    else:
                        logger.error(f"Failed to fetch page {current_page} after {max_retries} attempts: {e}")
                        raise  # Re-raise the exception after all retries failed
            
            results = data.get('results', [])
            total_fetched += len(results)
            logger.info(f"Fetched {len(results)} users (total so far: {total_fetched})")
            
            # Handle search filtering if needed
            if search_term:
                search_term_lower = search_term.lower()
                filtered_results = []
                for user in results:
                    # Get all searchable fields
                    searchable_text = []
                    
                    # Add standard fields
                    searchable_text.extend([
                        str(user.get('username', '')).lower(),
                        str(user.get('name', '')).lower(),
                        str(user.get('email', '')).lower()
                    ])
                    
                    # Add attributes content
                    attributes = user.get('attributes', {})
                    if isinstance(attributes, dict):
                        # Add all attribute values to searchable text
                        searchable_text.extend(str(value).lower() for value in attributes.values())
                    
                    # Check if search term is in any of the searchable text
                    if any(search_term_lower in text for text in searchable_text):
                        filtered_results.append(user)
                
                users.extend(filtered_results)
            else:
                users.extend(results)
            
            # FIXED: Check pagination field for next page
            pagination = data.get('pagination', {})
            next_page = pagination.get('next')
            total_pages = pagination.get('total_pages', 1)
            total_count = pagination.get('count', len(users))
            
            logger.info(f"Page {current_page}/{total_pages}, Total users available: {total_count}")
            
            # Stop if no more pages
            if not next_page or next_page <= current_page:
                logger.info("No more pages to fetch")
                break
                
            # Move to next page
            current_page = next_page

        logger.info(f"Total users fetched: {len(users)}")
        return users
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error listing users: {e}")
        return []


def test_fixed_pagination():
    """Test the fixed pagination function."""
    import os
    import sys
    
    # Add app directory to path
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))
    
    from app.utils.config import Config
    
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    print("Testing FIXED pagination...")
    users = list_users_fixed(Config.AUTHENTIK_API_URL, headers)
    print(f"✅ Successfully fetched {len(users)} users with fixed pagination!")
    
    if len(users) > 500:
        print("🎉 SUCCESS: Got more than 500 users - pagination is working!")
    else:
        print("⚠️  Still getting only 500 users - may need further debugging")
    
    return users

if __name__ == "__main__":
    test_fixed_pagination() 