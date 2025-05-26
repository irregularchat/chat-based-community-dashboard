import json

# Debug test to understand user option format and display name extraction
def test_user_option_parsing():
    # Simulate the actual format from the UI based on your screenshot
    user_option = "Joshua 📱 (@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com)"
    
    print("=== USER OPTION PARSING DEBUG ===")
    print(f"Original user_option: {repr(user_option)}")
    
    # Current extraction method
    user_id = user_option.split("(")[-1].rstrip(")")
    display_name_raw = user_option.split("(")[0].strip()
    display_name_clean = display_name_raw.replace(" 📱", "").strip()
    
    print(f"Extracted user_id: {repr(user_id)}")
    print(f"Raw display_name: {repr(display_name_raw)}")
    print(f"Clean display_name: {repr(display_name_clean)}")
    
    # Test the mention HTML generation (FIXED: no @ since template has it)
    mention_html = f'<a href="https://matrix.to/#/{user_id}" data-mention-type="user">{display_name_clean}</a>'
    print(f"Generated mention HTML: {repr(mention_html)}")
    
    print("\n=== EXPECTED vs ACTUAL ===")
    print(f"Expected display name: 'Joshua'")
    print(f"Actual display name: '{display_name_clean}'")
    print(f"Match: {display_name_clean == 'Joshua'}")
    
    # Test what happens if the user_id doesn't have the domain
    print("\n=== TESTING DIFFERENT USER ID FORMATS ===")
    
    # Test case 1: Full Matrix ID with domain
    test_user_id_1 = "@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com"
    username_1 = test_user_id_1.split(":")[0].lstrip("@") if ":" in test_user_id_1 else test_user_id_1.lstrip("@")
    print(f"Full Matrix ID: {test_user_id_1}")
    print(f"Extracted username: {username_1}")
    
    # Test case 2: Just the UUID part (what you mentioned seeing)
    test_user_id_2 = "signal_01383f13-1479-4058-b51b-d39244b679f4"
    username_2 = test_user_id_2.split(":")[0].lstrip("@") if ":" in test_user_id_2 else test_user_id_2.lstrip("@")
    print(f"UUID only: {test_user_id_2}")
    print(f"Extracted username: {username_2}")
    
    # Test case 3: What if the user_id in the mapping is wrong?
    print("\n=== TESTING MAPPING LOOKUP ===")
    user_id_to_display_name = {
        "@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com": "Joshua"
    }
    
    # Test different lookup scenarios
    lookup_1 = user_id_to_display_name.get("@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com", "NOT_FOUND")
    lookup_2 = user_id_to_display_name.get("signal_01383f13-1479-4058-b51b-d39244b679f4", "NOT_FOUND")
    
    print(f"Lookup with full ID: {lookup_1}")
    print(f"Lookup with UUID only: {lookup_2}")

def test_mention_format():
    user_id = "@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com"
    display_name = "Joshua"  # What we want to achieve
    removal_message = "@{username} is being removed for not verifying themselves after their safety number changed. This is done to maintain the integrity of the community. This could mean the number was assigned to a different person or their SIM was put into a different device.\n\nThey are welcome to request to join anytime but will need to be verified by knowing someone in the community and providing their name and organization."
    
    # FIXED: No @ in mention HTML since template already has @{username}
    mention_html = f'<a href="https://matrix.to/#/{user_id}" data-mention-type="user">{display_name}</a>'
    personalized_message = removal_message.replace("{username}", mention_html)
    
    message_content = {
        "msgtype": "m.text",
        "body": removal_message.replace("{username}", display_name),  # FIXED: No extra @ since template has it
        "format": "org.matrix.custom.html",
        "formatted_body": personalized_message,
        "m.mentions": {
            "user_ids": [user_id]
        }
    }
    
    print("\n=== FINAL MESSAGE FORMAT (FIXED) ===")
    print("Message body (plain text):")
    print(repr(message_content["body"]))
    print("\nMessage formatted_body (HTML):")
    print(repr(message_content["formatted_body"]))
    
    print("\n=== VERIFICATION ===")
    print("✅ Should show '@Joshua' (not '@@Joshua' or '@signal_...')")
    print(f"Plain text starts with: {repr(message_content['body'][:10])}")
    print(f"HTML starts with: {repr(message_content['formatted_body'][:50])}")

def test_debug_actual_issue():
    """Test what might be happening in the actual code"""
    print("\n=== DEBUGGING ACTUAL ISSUE ===")
    
    # Simulate what might be happening
    selected_removal_users = ["Joshua 📱 (@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com)"]
    selected_user_ids = ["@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com"]
    
    # Simulate the mapping creation
    user_id_to_display_name = {}
    
    # First, try to get display names from selected users list
    for user_option in selected_removal_users:
        user_id = user_option.split("(")[-1].rstrip(")")
        display_name = user_option.split("(")[0].strip()
        # Remove emoji indicators like 📱 from display name
        display_name = display_name.replace(" 📱", "").strip()
        user_id_to_display_name[user_id] = display_name
        print(f"Mapped: {user_id} -> {display_name}")
    
    # Now test the lookup
    for user_id in selected_user_ids:
        username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
        display_name = user_id_to_display_name.get(user_id, username)
        print(f"User ID: {user_id}")
        print(f"Username fallback: {username}")
        print(f"Final display_name: {display_name}")
        
        # This is what would be used in the mention
        mention_html = f'<a href="https://matrix.to/#/{user_id}" data-mention-type="user">{display_name}</a>'
        print(f"Mention HTML: {mention_html}")

def test_uuid_only_scenario():
    """Test the scenario where user_id is just the UUID without domain"""
    print("\n=== TESTING UUID-ONLY SCENARIO (THE LIKELY ISSUE) ===")
    
    # This might be what's actually happening - user_id is just the UUID
    selected_removal_users = ["Joshua 📱 (@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com)"]
    selected_user_ids = ["signal_01383f13-1479-4058-b51b-d39244b679f4"]  # Just UUID, no domain!
    
    print(f"Selected removal users: {selected_removal_users}")
    print(f"Selected user IDs: {selected_user_ids}")
    
    # Simulate the NEW robust mapping creation
    user_id_to_display_name = {}
    
    # First, try to get display names from selected users list
    for user_option in selected_removal_users:
        user_id = user_option.split("(")[-1].rstrip(")")
        display_name = user_option.split("(")[0].strip()
        # Remove emoji indicators like 📱 from display name
        display_name = display_name.replace(" 📱", "").strip()
        user_id_to_display_name[user_id] = display_name
        print(f"Mapped full ID: {user_id} -> {display_name}")
        
        # Also map the UUID-only version (without domain) for robustness
        if ":" in user_id:
            uuid_only = user_id.split(":")[0].lstrip("@")
            user_id_to_display_name[uuid_only] = display_name
            print(f"Also mapped UUID-only: {uuid_only} -> {display_name}")
    
    print(f"\nFinal mapping: {user_id_to_display_name}")
    
    # Now test the lookup with UUID-only user_id
    for user_id in selected_user_ids:
        username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
        
        # Get the display name for this user (fallback to username if not found)
        display_name = user_id_to_display_name.get(user_id, username)
        
        # If we didn't find a display name and the user_id doesn't have a domain,
        # try to construct the full Matrix ID and look it up
        if display_name == username and ":" not in user_id:
            # Try to construct full Matrix ID with irregularchat.com domain
            full_user_id = f"@{user_id}:irregularchat.com" if not user_id.startswith("@") else f"{user_id}:irregularchat.com"
            display_name = user_id_to_display_name.get(full_user_id, username)
            print(f"Tried full Matrix ID '{full_user_id}' -> display_name '{display_name}'")
        
        print(f"FINAL RESULT: User ID '{user_id}' -> username '{username}' -> display_name '{display_name}'")
        
        # This is what would be used in the mention
        mention_html = f'<a href="https://matrix.to/#/@{user_id}:irregularchat.com" data-mention-type="user">{display_name}</a>'
        print(f"Mention HTML: {mention_html}")
        
        # Test the message
        removal_message = "@{username} is being removed for not verifying themselves after their safety number changed."
        personalized_message = removal_message.replace("{username}", mention_html)
        plain_text = removal_message.replace("{username}", display_name)
        
        print(f"Plain text: {plain_text}")
        print(f"HTML: {personalized_message}")

if __name__ == "__main__":
    test_user_option_parsing()
    test_mention_format()
    test_debug_actual_issue()
    test_uuid_only_scenario() 