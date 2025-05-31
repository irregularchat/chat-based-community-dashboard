#!/usr/bin/env python3
"""
Test script to verify empty search results handling in the user list display.
This simulates the search functionality in app/ui/forms.py to ensure
empty searches display properly.

Usage:
    python scripts/test_empty_search.py
"""

import os
import sys
import logging
import pandas as pd

# Set up logging to both console and file
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),  # Log to console
        logging.FileHandler('test_empty_search.log')  # Also log to file
    ]
)
# Also print directly to console for visibility
print("Starting empty search test script...")

# Add parent directory to path to allow importing app modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Import necessary modules
try:
    from app.db.session import get_db
    from app.db.models import User
    logging.info("Successfully imported database modules")
except ImportError as e:
    logging.error(f"Failed to import modules: {e}")
    sys.exit(1)

def get_test_users():
    """Get all users from the database using the same logic as in forms.py."""
    try:
        # Get a database session
        db = next(get_db())
        try:
            # Get total count with SQLAlchemy
            total_count = db.query(User).count()
            logging.info(f"Total users in database: {total_count}")
            
            # Load users in batches
            users = []
            batch_size = 100
            offset = 0
            
            logging.info(f"Starting batch loading with {batch_size} users per batch")
            while offset < total_count:
                try:
                    batch = db.query(User).order_by(User.id).offset(offset).limit(batch_size).all()
                    if not batch:
                        logging.info(f"Empty batch at offset {offset}, breaking")
                        break
                    users.extend(batch)
                    offset += len(batch)
                    logging.info(f"Loaded batch: {len(users)}/{total_count} users")
                except Exception as e:
                    logging.error(f"Error loading batch: {e}")
                    if len(users) > 0:
                        break
                    raise
            
            logging.info(f"Batch loading complete: {len(users)}/{total_count} users loaded")
            return users
        finally:
            db.close()
    except Exception as e:
        logging.error(f"Error getting users from database: {e}")
        return []

def test_search_filtering(users, search_terms):
    """
    Test the search filtering logic with different search terms.
    
    Args:
        users: List of User objects
        search_terms: List of search terms to test
    """
    if not users:
        logging.error("No users available for testing")
        return
    
    logging.info(f"Testing {len(search_terms)} search terms on {len(users)} users")
    
    for search_term in search_terms:
        logging.info(f"\n--- Testing search term: '{search_term}' ---")
        
        # Filter users based on search term (same logic as in forms.py)
        search_lower = search_term.lower()
        filtered_users = [
            user for user in users
            if (search_lower in user.username.lower() or
                search_lower in user.first_name.lower() or
                search_lower in user.last_name.lower() or
                search_lower in (user.email or "").lower())
        ]
        
        # Show results
        matches = len(filtered_users)
        logging.info(f"Search for '{search_term}' returned {matches} users")
        
        # Test creating DataFrame with the filtered results
        user_data = []
        for user in filtered_users[:5]:  # Only process first 5 for demonstration
            user_dict = {
                "Username": user.username,
                "Name": f"{user.first_name} {user.last_name}",
                "Email": user.email,
                "Status": "Active" if user.is_active else "Inactive"
            }
            user_data.append(user_dict)
        
        # Here's where our fix comes in - create an empty DataFrame with structure if needed
        if not user_data:
            logging.info("Creating empty DataFrame with structure (this is our fix)")
            df = pd.DataFrame(columns=["Username", "Name", "Email", "Status"])
        else:
            df = pd.DataFrame(user_data)
            
        # Show the resulting DataFrame info
        logging.info(f"DataFrame shape: {df.shape}")
        logging.info(f"DataFrame columns: {list(df.columns)}")
        
        # Show a sample of the data if available
        if not df.empty:
            logging.info(f"Sample data:\n{df.head(2)}")
        else:
            logging.info("DataFrame is empty but has proper structure")

def main():
    """Main test function."""
    logging.info("Starting empty search test")
    
    # Get all users
    users = get_test_users()
    if not users:
        logging.error("Failed to get users for testing")
        return
    
    # Test various search terms including ones that should return no results
    search_terms = [
        "",              # Empty search (should return all users)
        "admin",         # Should find admin users
        "john",          # Common name, likely to find matches
        "sac",           # The problematic search term that returns no results
        "xyz123456",     # Unlikely to match any users
        "test"           # May match test users
    ]
    
    test_search_filtering(users, search_terms)
    logging.info("Empty search test completed")

if __name__ == "__main__":
    main()
