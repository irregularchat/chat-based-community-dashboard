#!/usr/bin/env python3
"""
Test script to debug the display_user_list function step by step.
This will help identify exactly where the table rendering is failing.

Usage:
    python scripts/debug_table_display.py
"""

import os
import sys
import logging

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

print("Testing table display logic...")

try:
    # Import required modules
    from app.db.session import get_db
    from app.db.models import User
    import pandas as pd
    
    def test_table_display_logic():
        """Test the core logic of display_user_list without Streamlit."""
        
        print("\n=== STEP 1: Get users from database ===")
        # Get users from database
        db = next(get_db())
        try:
            users = db.query(User).all()
            print(f"✓ Retrieved {len(users)} users from database")
        finally:
            db.close()
        
        if not users:
            print("❌ No users found - this would cause empty table")
            return
        
        print("\n=== STEP 2: Test filtering logic ===")
        # Simulate no search term (default state)
        search_term = ""  # Empty search term
        status_filter = "All"  # Default status filter
        
        # Filter users based on search and status
        filtered_users = users
        
        # Apply search filter (should be skipped for empty search)
        if search_term:
            print(f"Applying search filter for: '{search_term}'")
            # This should NOT execute for empty search
        else:
            print("✓ No search term - using all users")
        
        # Apply status filter
        if status_filter == "Active":
            filtered_users = [user for user in filtered_users if user.is_active]
            print(f"Applied Active filter: {len(filtered_users)} users")
        elif status_filter == "Inactive":
            filtered_users = [user for user in filtered_users if not user.is_active]
            print(f"Applied Inactive filter: {len(filtered_users)} users")
        else:
            print(f"✓ No status filter - keeping all {len(filtered_users)} users")
        
        print(f"Filtered users count: {len(filtered_users)}")
        
        print("\n=== STEP 3: Test pagination logic ===")
        # Pagination settings
        users_per_page = 500  # Default from the code
        page = 1  # Default page
        
        # Calculate pagination for filtered users
        if filtered_users:
            total_pages = (len(filtered_users) + users_per_page - 1) // users_per_page
        else:
            total_pages = 1
        
        print(f"Total pages: {total_pages}")
        
        # Calculate slice indices
        start_idx = (page - 1) * users_per_page
        end_idx = min(start_idx + users_per_page, len(filtered_users))
        
        print(f"Page {page}: showing users {start_idx + 1}-{end_idx} of {len(filtered_users)}")
        
        # Get users for current page
        page_users = filtered_users[start_idx:end_idx]
        print(f"✓ Page users count: {len(page_users)}")
        
        print("\n=== STEP 4: Test DataFrame creation ===")
        # Convert users to DataFrame for display
        user_data = []
        for user in page_users[:5]:  # Just test first 5 for speed
            user_dict = {
                "Username": user.username,
                "Name": f"{user.first_name} {user.last_name}",
                "Email": user.email,
                "Matrix Username": user.matrix_username or "Not set",
                "Status": "Active" if user.is_active else "Inactive",
                "Admin": "Yes" if user.is_admin else "No",
                "Date Joined": str(user.date_joined) if user.date_joined else "Not set",
                "Last Login": str(user.last_login) if user.last_login else "Never"
            }
            user_data.append(user_dict)
        
        print(f"✓ Created {len(user_data)} user data dictionaries")
        
        # Test DataFrame creation
        if not user_data:
            print("Creating empty DataFrame with structure...")
            df = pd.DataFrame(columns=[
                "Username", "Name", "Email", "Matrix Username", "Status", 
                "Admin", "Date Joined", "Last Login"
            ])
            print(f"✓ Empty DataFrame created with shape: {df.shape}")
        else:
            df = pd.DataFrame(user_data)
            print(f"✓ DataFrame created with shape: {df.shape}")
        
        print(f"DataFrame columns: {list(df.columns)}")
        
        if not df.empty:
            print("Sample DataFrame content:")
            print(df.head(2))
        else:
            print("DataFrame is empty but has proper structure")
        
        print("\n=== CONCLUSION ===")
        print(f"✓ Test completed successfully")
        print(f"✓ Users retrieved: {len(users)}")
        print(f"✓ Filtered users: {len(filtered_users)}")
        print(f"✓ Page users: {len(page_users)}")
        print(f"✓ DataFrame shape: {df.shape}")
        
        if len(page_users) > 0:
            print("✅ Table should render with data")
        else:
            print("⚠️ Table would be empty - check filtering logic")
    
    # Run the test
    test_table_display_logic()
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
