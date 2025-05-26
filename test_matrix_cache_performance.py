#!/usr/bin/env python3
"""
Test script to verify Matrix cache performance improvements.
This script tests that we're using cached data instead of slow Matrix API calls.
"""

import asyncio
import time
import logging
from app.db.session import get_db
from app.services.matrix_cache import matrix_cache

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_cache_performance():
    """Test that cache operations are fast compared to Matrix API calls."""
    
    print("🧪 Testing Matrix Cache Performance")
    print("=" * 50)
    
    # Test 1: Check cache freshness (should be very fast)
    print("\n1. Testing cache freshness check...")
    start_time = time.time()
    
    db = next(get_db())
    try:
        is_fresh = matrix_cache.is_cache_fresh(db, max_age_minutes=30)
        cache_check_time = time.time() - start_time
        
        print(f"   ✅ Cache freshness check: {cache_check_time:.3f}s")
        print(f"   📊 Cache is {'fresh' if is_fresh else 'stale'}")
        
        if cache_check_time > 0.1:
            print(f"   ⚠️  Warning: Cache check took {cache_check_time:.3f}s (should be < 0.1s)")
        
    finally:
        db.close()
    
    # Test 2: Get cached users (should be very fast)
    print("\n2. Testing cached user retrieval...")
    start_time = time.time()
    
    db = next(get_db())
    try:
        cached_users = matrix_cache.get_cached_users(db)
        user_retrieval_time = time.time() - start_time
        
        print(f"   ✅ User retrieval: {user_retrieval_time:.3f}s")
        print(f"   👥 Found {len(cached_users)} cached users")
        
        if user_retrieval_time > 0.1:
            print(f"   ⚠️  Warning: User retrieval took {user_retrieval_time:.3f}s (should be < 0.1s)")
        
        # Show sample users
        if cached_users:
            print(f"   📝 Sample users:")
            for i, user in enumerate(cached_users[:3]):
                print(f"      {i+1}. {user['display_name']} ({user['user_id']})")
            if len(cached_users) > 3:
                print(f"      ... and {len(cached_users) - 3} more")
        
    finally:
        db.close()
    
    # Test 3: Get cached rooms (should be very fast)
    print("\n3. Testing cached room retrieval...")
    start_time = time.time()
    
    db = next(get_db())
    try:
        cached_rooms = matrix_cache.get_cached_rooms(db)
        room_retrieval_time = time.time() - start_time
        
        print(f"   ✅ Room retrieval: {room_retrieval_time:.3f}s")
        print(f"   🏠 Found {len(cached_rooms)} cached rooms")
        
        if room_retrieval_time > 0.1:
            print(f"   ⚠️  Warning: Room retrieval took {room_retrieval_time:.3f}s (should be < 0.1s)")
        
        # Show sample rooms
        if cached_rooms:
            print(f"   📝 Sample rooms:")
            for i, room in enumerate(cached_rooms[:3]):
                print(f"      {i+1}. {room['name']} ({room['room_id']})")
            if len(cached_rooms) > 3:
                print(f"      ... and {len(cached_rooms) - 3} more")
        
    finally:
        db.close()
    
    # Test 4: Check sync status
    print("\n4. Testing sync status...")
    
    db = next(get_db())
    try:
        sync_status = matrix_cache.get_sync_status(db)
        if sync_status:
            print(f"   📅 Last sync: {sync_status.get('last_sync', 'Unknown')}")
            print(f"   📊 Status: {sync_status.get('status', 'Unknown')}")
            if sync_status.get('duration_seconds'):
                print(f"   ⏱️  Duration: {sync_status['duration_seconds']}s")
        else:
            print(f"   ❌ No sync record found - run a manual sync")
            
    finally:
        db.close()
    
    print("\n" + "=" * 50)
    print("🎉 Cache performance test completed!")
    print("\n💡 Key takeaways:")
    print("   • All cache operations should complete in < 0.1 seconds")
    print("   • No Matrix API calls should happen during normal UI operations")
    print("   • Manual sync should only be needed when cache is stale")
    print("   • Background sync will automatically refresh stale data")

if __name__ == "__main__":
    asyncio.run(test_cache_performance()) 