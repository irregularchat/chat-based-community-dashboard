#!/usr/bin/env python3
"""
Improved user sync functionality to fix the 500 user limitation.

This file contains enhanced versions of the user sync functions
that should handle large user bases more reliably.
"""

import logging
import time
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

def list_users_improved(auth_api_url: str, headers: dict, search_term: Optional[str] = None, max_retries: int = 5) -> List[Dict[str, Any]]:
    """
    Enhanced version of list_users that handles pagination more reliably.
    
    Improvements:
    - Increased page size from 500 to 1000
    - Better error handling and retry logic
    - Progress tracking
    - Memory optimization
    - Timeout handling
    
    Args:
        auth_api_url: The Authentik API URL
        headers: Request headers
        search_term: Optional search filter
        max_retries: Maximum retry attempts per page
        
    Returns:
        List of all users from Authentik
    """
    try:
        # Increase page size for better performance
        params = {'page_size': 1000}  # Increased from 500
        users = []
        url = f"{auth_api_url}/core/users/"
        page_count = 0
        total_fetched = 0
        
        logger.info("Starting enhanced user fetch from Authentik...")
        start_time = datetime.now()

        while url:
            page_count += 1
            page_start = datetime.now()
            logger.info(f"Fetching page {page_count}... (URL: {url[:100]}...)")
            
            # Retry logic for each page
            page_success = False
            last_error = None
            
            for retry in range(max_retries):
                try:
                    # Use longer timeout for large pages
                    response = requests.get(url, headers=headers, params=params, timeout=120)
                    response.raise_for_status()
                    data = response.json()
                    page_success = True
                    break  # Success, exit retry loop
                    
                except requests.exceptions.Timeout as e:
                    last_error = f"Timeout on page {page_count}"
                    logger.warning(f"Timeout on page {page_count}, retry {retry+1}/{max_retries}")
                    time.sleep(min(5 * (retry + 1), 30))  # Exponential backoff, max 30s
                    
                except requests.exceptions.ConnectionError as e:
                    last_error = f"Connection error on page {page_count}: {e}"
                    logger.warning(f"Connection error on page {page_count}, retry {retry+1}/{max_retries}")
                    time.sleep(min(3 * (retry + 1), 20))  # Exponential backoff
                    
                except requests.exceptions.HTTPError as e:
                    if response.status_code == 429:  # Rate limited
                        last_error = f"Rate limited on page {page_count}"
                        logger.warning(f"Rate limited on page {page_count}, retry {retry+1}/{max_retries}")
                        time.sleep(min(10 * (retry + 1), 60))  # Longer wait for rate limits
                    else:
                        last_error = f"HTTP error {response.status_code} on page {page_count}"
                        logger.error(f"HTTP error {response.status_code} on page {page_count}: {e}")
                        if retry < max_retries - 1:
                            time.sleep(2)
                        else:
                            raise  # Re-raise on final attempt
                            
                except Exception as e:
                    last_error = f"Unexpected error on page {page_count}: {e}"
                    logger.error(f"Unexpected error on page {page_count}, retry {retry+1}/{max_retries}: {e}")
                    if retry < max_retries - 1:
                        time.sleep(2)
                    else:
                        raise  # Re-raise on final attempt
            
            if not page_success:
                logger.error(f"Failed to fetch page {page_count} after {max_retries} attempts: {last_error}")
                # Continue with next page or break depending on strategy
                # For now, we'll break to avoid infinite loops
                break
            
            # Process the page data
            results = data.get('results', [])
            page_user_count = len(results)
            total_fetched += page_user_count
            
            page_duration = (datetime.now() - page_start).total_seconds()
            logger.info(f"Page {page_count}: fetched {page_user_count} users in {page_duration:.2f}s (total: {total_fetched})")
            
            # Apply search filtering if needed
            if search_term:
                filtered_results = filter_users_by_search(results, search_term)
                users.extend(filtered_results)
                logger.debug(f"Page {page_count}: {len(filtered_results)} users matched search term")
            else:
                users.extend(results)
            
            # Get next page URL
            url = data.get('next')
            params = {}  # Clear params after first request (they're in the next URL)
            
            # Progress logging every 10 pages
            if page_count % 10 == 0:
                elapsed = (datetime.now() - start_time).total_seconds()
                logger.info(f"Progress: {page_count} pages processed, {total_fetched} users fetched in {elapsed:.1f}s")
            
            # Optional: Add small delay to be nice to the API
            if page_count % 5 == 0:  # Every 5 pages
                time.sleep(0.5)

        # Final statistics
        total_duration = (datetime.now() - start_time).total_seconds()
        logger.info(f"User fetch completed: {len(users)} users in {page_count} pages, {total_duration:.2f}s total")
        
        # Validate results
        if len(users) == 500:
            logger.warning("⚠️  Fetched exactly 500 users - this may indicate pagination failure!")
        
        return users
        
    except Exception as e:
        logger.error(f"Critical error in enhanced user fetch: {e}")
        return []

def filter_users_by_search(users: List[Dict[str, Any]], search_term: str) -> List[Dict[str, Any]]:
    """
    Filter users by search term, checking multiple fields.
    
    Args:
        users: List of user dictionaries
        search_term: Search string
        
    Returns:
        Filtered list of users
    """
    if not search_term:
        return users
    
    search_term_lower = search_term.lower()
    filtered_results = []
    
    for user in users:
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
    
    return filtered_results

def sync_users_with_progress(db_session, authentik_users: List[Dict[str, Any]], batch_size: int = 100) -> bool:
    """
    Enhanced sync function with better progress tracking and error handling.
    
    Args:
        db_session: Database session
        authentik_users: List of users from Authentik
        batch_size: Number of users to process per batch
        
    Returns:
        True if sync was successful
    """
    try:
        total_users = len(authentik_users)
        processed = 0
        new_count = 0
        updated_count = 0
        error_count = 0
        
        logger.info(f"Starting enhanced sync of {total_users} users in batches of {batch_size}")
        start_time = datetime.now()
        
        # Process in batches
        for i in range(0, total_users, batch_size):
            batch = authentik_users[i:min(i + batch_size, total_users)]
            batch_start = datetime.now()
            
            batch_new = 0
            batch_updated = 0
            batch_errors = 0
            
            for user_data in batch:
                try:
                    # Process individual user
                    result = sync_single_user(db_session, user_data)
                    if result == 'new':
                        batch_new += 1
                    elif result == 'updated':
                        batch_updated += 1
                        
                except Exception as e:
                    batch_errors += 1
                    logger.error(f"Error syncing user {user_data.get('username', 'unknown')}: {e}")
            
            # Commit batch
            try:
                db_session.commit()
            except Exception as e:
                logger.error(f"Error committing batch: {e}")
                db_session.rollback()
                batch_errors += len(batch)
            
            # Update counters
            processed += len(batch)
            new_count += batch_new
            updated_count += batch_updated
            error_count += batch_errors
            
            # Progress logging
            batch_duration = (datetime.now() - batch_start).total_seconds()
            logger.info(f"Batch {i//batch_size + 1}: {len(batch)} users processed in {batch_duration:.2f}s "
                       f"({batch_new} new, {batch_updated} updated, {batch_errors} errors)")
            
            # Overall progress every 10 batches
            if (i // batch_size + 1) % 10 == 0:
                elapsed = (datetime.now() - start_time).total_seconds()
                percent = (processed / total_users) * 100
                logger.info(f"Overall progress: {processed}/{total_users} ({percent:.1f}%) in {elapsed:.1f}s")
        
        # Final summary
        total_duration = (datetime.now() - start_time).total_seconds()
        logger.info(f"Sync completed: {processed} users processed in {total_duration:.2f}s")
        logger.info(f"Results: {new_count} new, {updated_count} updated, {error_count} errors")
        
        return error_count == 0
        
    except Exception as e:
        logger.error(f"Critical error in enhanced sync: {e}")
        db_session.rollback()
        return False

def sync_single_user(db_session, user_data: Dict[str, Any]) -> str:
    """
    Sync a single user to the database.
    
    Args:
        db_session: Database session
        user_data: User data from Authentik
        
    Returns:
        'new', 'updated', or 'unchanged'
    """
    from app.db.models import User
    
    username = user_data.get('username')
    if not username:
        raise ValueError("User data missing username")
    
    # Try to find existing user
    existing_user = db_session.query(User).filter_by(username=username).first()
    
    if existing_user:
        # Update existing user
        updated = False
        
        if existing_user.email != user_data.get('email', ''):
            existing_user.email = user_data.get('email', '')
            updated = True
            
        if existing_user.first_name != user_data.get('first_name', ''):
            existing_user.first_name = user_data.get('first_name', '')
            updated = True
            
        if existing_user.last_name != user_data.get('last_name', ''):
            existing_user.last_name = user_data.get('last_name', '')
            updated = True
            
        if existing_user.is_active != user_data.get('is_active', True):
            existing_user.is_active = user_data.get('is_active', True)
            updated = True
            
        if existing_user.authentik_id != str(user_data.get('pk', '')):
            existing_user.authentik_id = str(user_data.get('pk', ''))
            updated = True
        
        return 'updated' if updated else 'unchanged'
    else:
        # Create new user
        new_user = User(
            username=username,
            email=user_data.get('email', ''),
            first_name=user_data.get('first_name', ''),
            last_name=user_data.get('last_name', ''),
            is_active=user_data.get('is_active', True),
            authentik_id=str(user_data.get('pk', ''))
        )
        db_session.add(new_user)
        return 'new'

# Example usage and testing functions
if __name__ == "__main__":
    print("Enhanced user sync functions loaded.")
    print("To use these functions, import them in your application:")
    print("  from user_sync_fix import list_users_improved, sync_users_with_progress") 