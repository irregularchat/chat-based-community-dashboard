#!/usr/bin/env python3

"""
Debug script to test default table loading logic step by step
This helps identify why the table isn't loading by default when no search is performed.
"""

import sys
import os

# Add the project root to Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from app.db.session import get_db
from app.db.models import User

def get_users_from_db():
    """Replicate the get_users_from_db function to test"""
    print("🔍 Testing get_users_from_db function...")
    
    try:
        db = next(get_db())
        users = db.query(User).all()
        print(f"✅ Successfully loaded {len(users)} users from database")
        return users
    except Exception as e:
        print(f"❌ Error loading users: {e}")
        return []
    finally:
        if 'db' in locals():
            db.close()

def test_default_table_logic():
    """Test the exact logic flow that happens when no search term is provided"""
    print("\n🧪 Testing default table loading logic...")
    
    # Step 1: Load users from database
    users = get_users_from_db()
    if not users:
        print("❌ No users loaded from database - this is the root issue")
        return
    
    print(f"📊 Total users loaded: {len(users)}")
    
    # Step 2: Initialize filtered_users (this is what happens in display_user_list)
    filtered_users = users
    print(f"🔍 Initial filtered_users count: {len(filtered_users)}")
    
    # Step 3: Test search logic (when search_term is empty/None)
    search_term = ""  # This is what happens by default
    
    print(f"🔍 Search term: '{search_term}'")
    print(f"🔍 Search term boolean: {bool(search_term)}")
    
    # This is the exact condition from the code
    if search_term:
        print("🔍 Search filtering WOULD run (but search_term is empty)")
    else:
        print("🔍 Search filtering SKIPPED (search_term is empty) - filtered_users should remain unchanged")
    
    print(f"🔍 After search logic, filtered_users count: {len(filtered_users)}")
    
    # Step 4: Test status filter (default is "All")
    status_filter = "All"  # This is the default
    
    print(f"📋 Status filter: '{status_filter}'")
    
    if status_filter == "Active":
        filtered_users = [user for user in filtered_users if user.is_active]
        print("📋 Applied Active filter")
    elif status_filter == "Inactive":
        filtered_users = [user for user in filtered_users if not user.is_active]
        print("📋 Applied Inactive filter")
    else:
        print("📋 No status filter applied (All selected)")
    
    print(f"📋 After status filter, filtered_users count: {len(filtered_users)}")
    
    # Step 5: Test the empty check
    if not filtered_users:
        print("⚠️  filtered_users is empty - this would show 'No users found' warning")
        print("⚠️  This is the problem! filtered_users should not be empty when no search/filter applied")
    else:
        print("✅ filtered_users is not empty - table should display")
    
    # Step 6: Test pagination logic
    users_per_page = 500  # Default value
    
    if filtered_users:
        total_pages = (len(filtered_users) + users_per_page - 1) // users_per_page
    else:
        total_pages = 1
    
    print(f"📄 Pagination: {total_pages} pages with {users_per_page} users per page")
    
    # Step 7: Test current page logic
    page = 1  # Default
    start_idx = (page - 1) * users_per_page
    end_idx = min(start_idx + users_per_page, len(filtered_users))
    
    print(f"📄 Page {page}: showing users {start_idx + 1}-{end_idx} of {len(filtered_users)}")
    
    # Step 8: Test page users extraction
    page_users = filtered_users[start_idx:end_idx]
    print(f"📄 Page users count: {len(page_users)}")
    
    if page_users:
        print("✅ page_users is not empty - DataFrame should be created with data")
        print(f"📋 Sample usernames: {[u.username for u in page_users[:3]]}")
    else:
        print("⚠️  page_users is empty - DataFrame would be empty")
    
    # Step 9: Test DataFrame creation logic
    user_data = []
    for user in page_users:
        user_dict = {
            "Username": user.username,
            "Name": f"{user.first_name} {user.last_name}",
            "Email": user.email,
            "Matrix Username": user.matrix_username or "Not set",
            "Status": "Active" if user.is_active else "Inactive",
            "Admin": "Yes" if user.is_admin else "No",
        }
        user_data.append(user_dict)
    
    print(f"📊 DataFrame data rows: {len(user_data)}")
    
    if not user_data:
        print("⚠️  user_data is empty - would create empty DataFrame structure")
    else:
        print("✅ user_data has content - would create populated DataFrame")
    
    print("\n🎯 CONCLUSION:")
    if users and filtered_users and page_users and user_data:
        print("✅ All steps successful - table should display by default")
        print("❓ If table is not showing in the app, the issue might be:")
        print("   - Streamlit session state interference")
        print("   - Exception in DataFrame display")
        print("   - UI rendering issue")
    else:
        print("❌ Found the issue in the logic chain:")
        if not users:
            print("   - Users not loading from database")
        if not filtered_users:
            print("   - filtered_users becoming empty")
        if not page_users:
            print("   - page_users becoming empty")
        if not user_data:
            print("   - user_data not being created")

if __name__ == "__main__":
    print("🧪 DEBUG: Default Table Loading Logic")
    print("=" * 50)
    test_default_table_logic()
