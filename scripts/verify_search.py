#!/usr/bin/env python3
"""
Test script to check for specific search terms in user data.
This directly queries the database to find users matching search terms,
bypassing the Streamlit UI to verify if data exists.

Usage:
    python scripts/verify_search.py
"""

import os
import sys
import logging
import sqlite3

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('verify_search.log')
    ]
)

print("Starting database search verification...")

def verify_search_term(search_term):
    """
    Directly check the database for users matching the search term
    
    Args:
        search_term: The term to search for
    """
    search_lower = search_term.lower()
    print(f"\n{'='*50}")
    print(f"SEARCH VERIFICATION: '{search_term}'")
    print(f"{'='*50}")
    
    try:
        # Connect directly to SQLite database
        conn = sqlite3.connect('local_dev.db')
        cursor = conn.cursor()
        
        # Get total user count
        cursor.execute('SELECT COUNT(*) FROM users')
        total_count = cursor.fetchone()[0]
        print(f"Total users in database: {total_count}")
        
        # Query for users where search term appears in any field
        query = """
        SELECT id, username, first_name, last_name, email 
        FROM users
        WHERE 
            LOWER(username) LIKE ? OR
            LOWER(first_name) LIKE ? OR
            LOWER(last_name) LIKE ? OR
            LOWER(email) LIKE ?
        """
        search_pattern = f'%{search_lower}%'
        cursor.execute(query, (search_pattern, search_pattern, search_pattern, search_pattern))
        matching_users = cursor.fetchall()
        
        print(f"Found {len(matching_users)} users matching '{search_term}'")
        
        # Display sample of matching users
        if matching_users:
            print("\nSample matches:")
            for i, user in enumerate(matching_users[:10]):  # Show up to 10 matches
                user_id, username, first_name, last_name, email = user
                print(f"{i+1}. User #{user_id}: {username} - {first_name} {last_name} ({email})")
            
            if len(matching_users) > 10:
                print(f"... and {len(matching_users) - 10} more")
        
        # Count matches by field
        cursor.execute('SELECT COUNT(*) FROM users WHERE LOWER(username) LIKE ?', (search_pattern,))
        username_matches = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM users WHERE LOWER(first_name) LIKE ?', (search_pattern,))
        first_name_matches = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM users WHERE LOWER(last_name) LIKE ?', (search_pattern,))
        last_name_matches = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM users WHERE LOWER(email) LIKE ?', (search_pattern,))
        email_matches = cursor.fetchone()[0]
        
        print("\nMatches by field:")
        print(f"- Username: {username_matches}")
        print(f"- First name: {first_name_matches}")
        print(f"- Last name: {last_name_matches}")
        print(f"- Email: {email_matches}")
        
    except Exception as e:
        print(f"Error during database search: {e}")
        import traceback
        print(traceback.format_exc())
    finally:
        if 'conn' in locals():
            conn.close()

def main():
    """Run search verification for multiple terms."""
    # Check multiple search terms
    search_terms = [
        "tim",     # The search term from the screenshot
        "john",    # Common name that should match
        "admin",   # Should match the admin user
        "sac",     # Term that previously returned no results
        "an",      # Should match many names (like Andrew, Dan, etc.)
        "er",      # Should match many names (like Tyler, Peter, etc.)
        "thomas",  # Common name that should match
        "t",       # Single letter to match any name with 't'
    ]
    
    for term in search_terms:
        verify_search_term(term)
    
    print("\nSearch verification completed")

if __name__ == "__main__":
    main()
