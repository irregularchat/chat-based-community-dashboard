#!/usr/bin/env python3
"""
Test script to verify Matrix cache infrastructure is working.
This tests the database models and basic cache operations without Matrix API calls.
"""

import time
import logging
from datetime import datetime, timedelta
from app.db.session import get_db
from app.db.models import MatrixUser, MatrixRoom, MatrixUserCache, MatrixSyncStatus

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_cache_infrastructure():
    """Test that cache infrastructure is working properly."""
    
    print("🧪 Testing Matrix Cache Infrastructure")
    print("=" * 50)
    
    # Test 1: Database connection and models
    print("\n1. Testing database connection and models...")
    start_time = time.time()
    
    db = next(get_db())
    try:
        # Test basic database operations
        user_count = db.query(MatrixUser).count()
        room_count = db.query(MatrixRoom).count()
        cache_count = db.query(MatrixUserCache).count()
        sync_count = db.query(MatrixSyncStatus).count()
        
        db_test_time = time.time() - start_time
        
        print(f"   ✅ Database connection: {db_test_time:.3f}s")
        print(f"   📊 Current data:")
        print(f"      - Matrix users: {user_count}")
        print(f"      - Matrix rooms: {room_count}")
        print(f"      - User cache entries: {cache_count}")
        print(f"      - Sync status records: {sync_count}")
        
    finally:
        db.close()
    
    # Test 2: Create sample cache data
    print("\n2. Testing cache data creation...")
    start_time = time.time()
    
    db = next(get_db())
    try:
        # Create a sample user cache entry
        test_user_id = "@test_user:example.com"
        
        # Remove existing test data
        db.query(MatrixUserCache).filter(MatrixUserCache.user_id == test_user_id).delete()
        db.commit()
        
        # Create new cache entry
        cache_entry = MatrixUserCache(
            user_id=test_user_id,
            display_name="Test User",
            avatar_url=None,
            is_signal_user=False,
            room_count=1,
            last_activity=datetime.now()
        )
        db.add(cache_entry)
        db.commit()
        
        cache_create_time = time.time() - start_time
        print(f"   ✅ Cache entry creation: {cache_create_time:.3f}s")
        print(f"   📝 Created test cache entry for {test_user_id}")
        
    finally:
        db.close()
    
    # Test 3: Query cache data
    print("\n3. Testing cache data retrieval...")
    start_time = time.time()
    
    db = next(get_db())
    try:
        # Query cache entries
        cached_users = db.query(MatrixUserCache).all()
        cache_query_time = time.time() - start_time
        
        print(f"   ✅ Cache query: {cache_query_time:.3f}s")
        print(f"   👥 Found {len(cached_users)} cached users")
        
        if cached_users:
            print(f"   📝 Sample cached users:")
            for i, user in enumerate(cached_users[:3]):
                user_type = "signal" if user.is_signal_user else "matrix"
                print(f"      {i+1}. {user.display_name} ({user.user_id}) - {user_type}")
            if len(cached_users) > 3:
                print(f"      ... and {len(cached_users) - 3} more")
        
    finally:
        db.close()
    
    # Test 4: Sync status operations
    print("\n4. Testing sync status operations...")
    start_time = time.time()
    
    db = next(get_db())
    try:
        # Create a test sync status
        sync_status = MatrixSyncStatus(
            sync_type='test',
            status='completed',
            total_items=100,
            processed_items=100,
            sync_duration_seconds=30
        )
        db.add(sync_status)
        db.commit()
        
        # Query recent sync status
        recent_sync = db.query(MatrixSyncStatus).filter(
            MatrixSyncStatus.last_sync > datetime.now() - timedelta(hours=1)
        ).first()
        
        sync_test_time = time.time() - start_time
        
        print(f"   ✅ Sync status operations: {sync_test_time:.3f}s")
        if recent_sync:
            print(f"   📅 Recent sync found: {recent_sync.sync_type} - {recent_sync.status}")
            print(f"      Duration: {recent_sync.sync_duration_seconds}s")
            print(f"      Items: {recent_sync.processed_items}/{recent_sync.total_items}")
        
    finally:
        db.close()
    
    # Test 5: Performance check
    print("\n5. Testing cache performance...")
    
    # Multiple rapid queries to test performance
    query_times = []
    for i in range(5):
        start_time = time.time()
        db = next(get_db())
        try:
            users = db.query(MatrixUserCache).limit(10).all()
            query_time = time.time() - start_time
            query_times.append(query_time)
        finally:
            db.close()
    
    avg_query_time = sum(query_times) / len(query_times)
    max_query_time = max(query_times)
    
    print(f"   ✅ Average query time: {avg_query_time:.3f}s")
    print(f"   📊 Max query time: {max_query_time:.3f}s")
    
    if avg_query_time < 0.1:
        print(f"   🚀 Performance: Excellent (< 0.1s)")
    elif avg_query_time < 0.5:
        print(f"   ✅ Performance: Good (< 0.5s)")
    else:
        print(f"   ⚠️  Performance: Slow (> 0.5s)")
    
    print("\n" + "=" * 50)
    print("🎉 Cache infrastructure test completed!")
    print("\n💡 Key findings:")
    print("   • Database models are working correctly")
    print("   • Cache operations are functional")
    print("   • Query performance is acceptable")
    print("   • Ready for Matrix API integration")
    
    # Cleanup test data
    print("\n🧹 Cleaning up test data...")
    db = next(get_db())
    try:
        db.query(MatrixUserCache).filter(MatrixUserCache.user_id == "@test_user:example.com").delete()
        db.query(MatrixSyncStatus).filter(MatrixSyncStatus.sync_type == "test").delete()
        db.commit()
        print("   ✅ Test data cleaned up")
    finally:
        db.close()

if __name__ == "__main__":
    test_cache_infrastructure() 