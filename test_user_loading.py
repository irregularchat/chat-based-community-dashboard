#!/usr/bin/env python3
"""
Test script to verify user loading from the database.
This helps diagnose why only 500 users are displayed in the UI.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db.database import SessionLocal
from app.db.models import User
import logging

logging.basicConfig(level=logging.INFO)

def test_user_loading():
    """Test loading users from the database."""
    print("=== Testing User Loading from Database ===\n")
    
    # Create a database session
    db = SessionLocal()
    
    try:
        # Test 1: Direct count
        count = db.query(User).count()
        print(f"1. Direct count query: {count} users")
        
        # Test 2: Load all users at once
        users_all = db.query(User).all()
        print(f"2. Load all users with .all(): {len(users_all)} users")
        
        # Test 3: Check if we get exactly 500
        if len(users_all) == 500:
            print("   WARNING: Exactly 500 users returned!")
            
        # Test 4: Load with explicit no limit
        users_no_limit = db.query(User).limit(None).all()
        print(f"3. Load with explicit limit(None): {len(users_no_limit)} users")
        
        # Test 5: Load in batches
        print("\n4. Loading in batches:")
        batch_size = 200
        offset = 0
        batched_users = []
        
        while True:
            batch = db.query(User).offset(offset).limit(batch_size).all()
            if not batch:
                break
            batched_users.extend(batch)
            print(f"   Batch {offset//batch_size + 1}: {len(batch)} users (total so far: {len(batched_users)})")
            offset += batch_size
            
        print(f"   Total from batches: {len(batched_users)} users")
        
        # Test 6: Raw SQL
        result = db.execute("SELECT COUNT(*) FROM users")
        raw_count = result.scalar()
        print(f"\n5. Raw SQL count: {raw_count} users")
        
        # Test 7: Check for duplicates
        usernames = [u.username for u in users_all]
        unique_usernames = set(usernames)
        print(f"\n6. Unique usernames: {len(unique_usernames)} (duplicates: {len(usernames) - len(unique_usernames)})")
        
        # Show sample users
        if users_all:
            print(f"\n7. Sample users:")
            print(f"   First 5: {[u.username for u in users_all[:5]]}")
            if len(users_all) > 5:
                print(f"   Last 5: {[u.username for u in users_all[-5:]]}")
                
        # Check database type
        db_url = str(db.bind.url)
        print(f"\n8. Database URL: {db_url}")
        print(f"   Database type: {'SQLite' if 'sqlite' in db_url else 'PostgreSQL'}")
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        
    finally:
        db.close()
        
    print("\n=== Test Complete ===")

if __name__ == "__main__":
    test_user_loading() 