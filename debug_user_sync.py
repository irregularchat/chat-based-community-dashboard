#!/usr/bin/env python3
"""
Diagnostic script to debug user sync issues.

This script helps identify why only ~500 users are being imported/displayed
by testing various parts of the sync process.

Usage:
    python debug_user_sync.py [--test-api] [--test-sync] [--verbose]
"""

import os
import sys
import argparse
import logging
from datetime import datetime

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

try:
    from app.utils.config import Config
    from app.auth.api import list_users
    from app.db.database import SessionLocal
    from app.db.models import User
    from app.db.operations import sync_user_data_incremental
except ImportError as e:
    print(f"Error importing modules: {e}")
    print("Make sure you're running this from the project root directory")
    sys.exit(1)

def setup_logging(verbose=False):
    """Set up logging for the diagnostic script."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler('user_sync_debug.log')
        ]
    )

def test_authentik_api():
    """Test fetching users from Authentik API."""
    print("\n=== Testing Authentik API ===")
    
    # Check configuration
    print(f"AUTHENTIK_API_URL: {Config.AUTHENTIK_API_URL}")
    print(f"AUTHENTIK_API_TOKEN: {'*' * 20 if Config.AUTHENTIK_API_TOKEN else 'NOT SET'}")
    
    if not Config.AUTHENTIK_API_TOKEN:
        print("❌ AUTHENTIK_API_TOKEN not configured")
        return []
    
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    try:
        print("Fetching users from Authentik API...")
        start_time = datetime.now()
        
        users = list_users(Config.AUTHENTIK_API_URL, headers)
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        print(f"✅ Successfully fetched {len(users)} users in {duration:.2f} seconds")
        
        # Show sample users
        if users:
            print("\nSample users:")
            for i, user in enumerate(users[:5]):
                print(f"  {i+1}. {user.get('username')} ({user.get('email')})")
            
            if len(users) > 5:
                print(f"  ... and {len(users) - 5} more users")
        
        return users
        
    except Exception as e:
        print(f"❌ Error fetching users from API: {e}")
        logging.error(f"API Error: {e}", exc_info=True)
        return []

def test_database():
    """Test database connection and current user count."""
    print("\n=== Testing Database ===")
    
    try:
        db = SessionLocal()
        
        # Test connection
        total_users = db.query(User).count()
        print(f"Current users in database: {total_users}")
        
        # Show sample users
        sample_users = db.query(User).limit(10).all()
        if sample_users:
            print("\nSample users in database:")
            for user in sample_users:
                print(f"  - {user.username} ({user.email}) - Active: {user.is_active}")
        else:
            print("No users found in database")
        
        db.close()
        return total_users
        
    except Exception as e:
        print(f"❌ Database error: {e}")
        logging.error(f"Database Error: {e}", exc_info=True)
        return 0

def test_sync_process(authentik_users, max_users=100):
    """Test the sync process with a limited number of users."""
    print(f"\n=== Testing Sync Process (max {max_users} users) ===")
    
    if not authentik_users:
        print("❌ No users to sync")
        return False
    
    # Limit users for testing
    test_users = authentik_users[:max_users]
    print(f"Testing sync with {len(test_users)} users...")
    
    try:
        db = SessionLocal()
        
        # Record initial count
        initial_count = db.query(User).count()
        print(f"Initial database count: {initial_count}")
        
        # Perform sync
        start_time = datetime.now()
        success = sync_user_data_incremental(db, test_users, full_sync=False)
        end_time = datetime.now()
        
        # Check results
        final_count = db.query(User).count()
        new_users = final_count - initial_count
        duration = (end_time - start_time).total_seconds()
        
        print(f"Sync completed in {duration:.2f} seconds")
        print(f"Result: {final_count} total users ({new_users:+d})")
        
        if success:
            print("✅ Sync completed successfully")
        else:
            print("❌ Sync reported failure")
        
        db.close()
        return success
        
    except Exception as e:
        print(f"❌ Sync error: {e}")
        logging.error(f"Sync Error: {e}", exc_info=True)
        return False

def run_full_analysis():
    """Run complete diagnostic analysis."""
    print("=" * 60)
    print("User Sync Diagnostic Script")
    print("=" * 60)
    
    # Test 1: Database
    db_count = test_database()
    
    # Test 2: API
    authentik_users = test_authentik_api()
    
    # Test 3: Sync (if we have users from API)
    if authentik_users:
        test_sync_process(authentik_users, max_users=50)
    
    # Summary
    print("\n=== Summary ===")
    print(f"Database users: {db_count}")
    print(f"Authentik users: {len(authentik_users)}")
    
    if len(authentik_users) > db_count:
        missing = len(authentik_users) - db_count
        print(f"❌ Missing users: {missing}")
        print("Recommendation: Run full sync to import all users")
    elif len(authentik_users) == db_count:
        print("✅ User counts match")
    else:
        print("⚠️  Database has more users than API returned")
    
    # Check for the 500 limit issue
    if len(authentik_users) == 500:
        print("⚠️  API returned exactly 500 users - pagination may have failed")
    
    print(f"\nLog file: user_sync_debug.log")

def main():
    parser = argparse.ArgumentParser(description='Debug user sync issues')
    parser.add_argument('--test-api', action='store_true', help='Test Authentik API only')
    parser.add_argument('--test-sync', action='store_true', help='Test sync process only')
    parser.add_argument('--verbose', '-v', action='store_true', help='Enable verbose logging')
    
    args = parser.parse_args()
    
    setup_logging(args.verbose)
    
    if args.test_api:
        test_authentik_api()
    elif args.test_sync:
        # Need to fetch users first
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        users = list_users(Config.AUTHENTIK_API_URL, headers)
        test_sync_process(users)
    else:
        run_full_analysis()

if __name__ == "__main__":
    main() 