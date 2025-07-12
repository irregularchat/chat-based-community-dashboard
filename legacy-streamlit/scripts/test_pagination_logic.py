#!/usr/bin/env python3
"""
Test pagination logic with 1 user to debug the table display issue.
"""

print("Starting pagination test...")

def test_pagination_logic():
    """Test the pagination calculation with 1 filtered user."""
    
    # Simulate the exact conditions from the screenshot
    filtered_users_count = 1
    users_per_page = 500  # Default value from the UI
    
    print(f"Testing pagination with {filtered_users_count} filtered users")
    print(f"Users per page: {users_per_page}")
    
    # Calculate pagination (same logic as in forms.py)
    if filtered_users_count:
        total_pages = (filtered_users_count + users_per_page - 1) // users_per_page
    else:
        total_pages = 1
    
    print(f"Total pages calculated: {total_pages}")
    
    # Page selection (would be 1 since total_pages = 1)
    page = 1
    print(f"Current page: {page}")
    
    # Calculate slice indices
    start_idx = (page - 1) * users_per_page
    end_idx = min(start_idx + users_per_page, filtered_users_count)
    
    print(f"Start index: {start_idx}")
    print(f"End index: {end_idx}")
    print(f"Should show users {start_idx + 1}-{end_idx} of {filtered_users_count}")
    
    # Simulate page_users slice
    # page_users = filtered_users[start_idx:end_idx]
    # With 1 user, this would be filtered_users[0:1] = [user]
    page_users_count = end_idx - start_idx
    print(f"Page users count: {page_users_count}")
    
    if page_users_count > 0:
        print("✅ Should display table with user data")
    else:
        print("❌ No users to display - this could be the issue!")

if __name__ == "__main__":
    test_pagination_logic()
    print("Test completed.")
