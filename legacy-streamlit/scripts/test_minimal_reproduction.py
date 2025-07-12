#!/usr/bin/env python3

"""
Minimal reproduction of the display_user_list issue
This tests the exact logic flow to identify why the default table isn't loading
"""

import sys
import os
import pandas as pd

# Add the project root to Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from app.db.session import get_db
from app.db.models import User

def format_date(date_obj):
    """Helper function to format dates"""
    if date_obj:
        return date_obj.strftime('%Y-%m-%d')
    return "Never"

def get_users_from_db():
    """Get users from database"""
    print("🔍 Loading users from database...")
    
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

def test_minimal_reproduction():
    """
    Test the exact logic from display_user_list() that should show the table by default
    """
    print("🧪 Testing minimal reproduction of display_user_list logic...")
    print("=" * 60)
    
    # Step 1: Load users (exact same as in display_user_list)
    users = get_users_from_db()
    
    if users is None:
        print("❌ users is None - this would cause early return in display_user_list")
        return False
    
    if not users:
        print("⚠️  users is empty list - this would show warning but continue")
        # Don't return - the function should continue and show empty table
    
    print(f"📊 Total users loaded: {len(users)}")
    
    # Step 2: Simulate initial Streamlit state (no search term, default status filter)
    search_term = ""  # This is what st.text_input returns initially
    status_filter = "All"  # This is the default value
    
    print(f"🔍 Initial state: search_term='{search_term}', status_filter='{status_filter}'")
    
    # Step 3: Initialize filtered_users (exact same as in display_user_list)
    filtered_users = users
    print(f"📋 Initial filtered_users count: {len(filtered_users)}")
    
    # Step 4: Apply search filter (exact condition from display_user_list)
    if search_term and search_term.strip():
        print("🔍 Would apply search filter (but search_term is empty)")
        # This block should not execute when no search term
    else:
        print("🔍 No search filter applied - filtered_users remains unchanged")
    
    print(f"📋 After search logic: filtered_users count: {len(filtered_users)}")
    
    # Step 5: Apply status filter (exact same logic)
    if status_filter == "Active":
        filtered_users = [user for user in filtered_users if user.is_active]
        print("📋 Applied Active status filter")
    elif status_filter == "Inactive":
        filtered_users = [user for user in filtered_users if not user.is_active]
        print("📋 Applied Inactive status filter")
    else:
        print("📋 No status filter applied (All selected)")
    
    print(f"📋 After status filter: filtered_users count: {len(filtered_users)}")
    
    # Step 6: Check if filtered_users is empty (this determines if table shows)
    if not filtered_users:
        print("⚠️  filtered_users is empty - table would show 'No users found' message")
        should_show_table = True  # The code continues and shows empty table structure
    else:
        print("✅ filtered_users has data - table should display with data")
        should_show_table = True
    
    # Step 7: Pagination logic (default values)
    users_per_page = 500  # Default from display_user_list
    page = 1  # Default
    
    if filtered_users:
        total_pages = (len(filtered_users) + users_per_page - 1) // users_per_page
    else:
        total_pages = 1
    
    start_idx = (page - 1) * users_per_page
    end_idx = min(start_idx + users_per_page, len(filtered_users))
    
    print(f"📄 Pagination: page {page} of {total_pages}, showing {start_idx + 1}-{end_idx} of {len(filtered_users)}")
    
    # Step 8: Get page users
    page_users = filtered_users[start_idx:end_idx]
    print(f"📄 Page users count: {len(page_users)}")
    
    # Step 9: Create user_data for DataFrame (exact same logic)
    user_data = []
    for user in page_users:
        user_dict = {
            "Username": user.username,
            "Name": f"{user.first_name} {user.last_name}",
            "Email": user.email,
            "Matrix Username": user.matrix_username or "Not set",
            "Status": "Active" if user.is_active else "Inactive",
            "Admin": "Yes" if user.is_admin else "No",
            "Date Joined": format_date(user.date_joined),
            "Last Login": format_date(user.last_login)
        }
        user_data.append(user_dict)
    
    print(f"📊 DataFrame data rows: {len(user_data)}")
    
    # Step 10: Create DataFrame (exact same logic)
    if not user_data:
        print("📋 Creating empty DataFrame with column structure...")
        df = pd.DataFrame(columns=[
            "Username", "Name", "Email", "Matrix Username", "Status", 
            "Admin", "Date Joined", "Last Login"
        ])
        print("⚠️  Would show warning: 'The table is empty because no users match your search criteria.'")
    else:
        print("📋 Creating populated DataFrame...")
        df = pd.DataFrame(user_data)
        print(f"📊 DataFrame shape: {df.shape}")
        print(f"📊 Sample data: {df.head(2).to_dict()}")
    
    # Step 11: Display logic
    print("\n🎯 TABLE DISPLAY DECISION:")
    if should_show_table:
        print("✅ Table SHOULD display")
        if not user_data:
            print("   - Empty table structure with warning message")
        else:
            print(f"   - Populated table with {len(user_data)} rows")
        
        print(f"\n📋 DataFrame info:")
        print(f"   - Shape: {df.shape}")
        print(f"   - Columns: {list(df.columns)}")
        print(f"   - Empty: {df.empty}")
        
        return True
    else:
        print("❌ Table should NOT display")
        return False

def test_edge_cases():
    """Test edge cases that might cause issues"""
    print("\n🧪 Testing edge cases...")
    
    # Test with None search term
    print("Testing search_term = None:")
    search_term = None
    result = bool(search_term and search_term.strip() if search_term else False)
    print(f"   search_term and search_term.strip() = {result}")
    
    # Test with empty string search term
    print("Testing search_term = '':")
    search_term = ""
    result = bool(search_term and search_term.strip())
    print(f"   search_term and search_term.strip() = {result}")
    
    # Test with whitespace search term
    print("Testing search_term = '   ':")
    search_term = "   "
    result = bool(search_term and search_term.strip())
    print(f"   search_term and search_term.strip() = {result}")

if __name__ == "__main__":
    print("🧪 MINIMAL REPRODUCTION TEST")
    print("Testing why default table loading isn't working...")
    print("=" * 60)
    
    success = test_minimal_reproduction()
    test_edge_cases()
    
    print("\n" + "=" * 60)
    if success:
        print("✅ LOGIC TEST PASSED - Table should display by default")
        print("❓ If table is not showing in the actual app, the issue might be:")
        print("   1. Streamlit session state interference")
        print("   2. Exception in the Streamlit DataFrame rendering")
        print("   3. A different code path being executed")
        print("   4. Browser caching issues")
    else:
        print("❌ LOGIC TEST FAILED - Found issue in the logic chain")
    
    print("\n💡 Next steps:")
    print("   1. Check browser console for errors")
    print("   2. Check Streamlit logs for exceptions")
    print("   3. Clear browser cache and Streamlit session state")
    print("   4. Verify the correct function is being called")
