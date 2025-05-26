#!/usr/bin/env python3
"""
Comprehensive test for mention formatting with all user ID formats
"""

def test_template_preview_logic():
    print("=== TESTING TEMPLATE PREVIEW LOGIC ===")
    
    # Test scenarios for template preview
    test_cases = [
        {
            "name": "Full Matrix ID from UI selection",
            "selected_removal_users": ["Joshua 📱 (@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com)"],
            "selected_user_ids": ["@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com"],
            "expected_display_name": "Joshua"
        },
        {
            "name": "UUID-only manual entry",
            "selected_removal_users": [],
            "selected_user_ids": ["signal_01383f13-1479-4058-b51b-d39244b679f4"],
            "expected_display_name": "signal_01383f13-1479-4058-b51b-d39244b679f4"  # Fallback to username
        },
        {
            "name": "UUID with @ prefix manual entry",
            "selected_removal_users": [],
            "selected_user_ids": ["@signal_01383f13-1479-4058-b51b-d39244b679f4"],
            "expected_display_name": "signal_01383f13-1479-4058-b51b-d39244b679f4"  # Fallback to username
        },
        {
            "name": "Mixed: UI selection with UUID manual entry",
            "selected_removal_users": ["Joshua 📱 (@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com)"],
            "selected_user_ids": ["signal_01383f13-1479-4058-b51b-d39244b679f4"],  # UUID-only should match
            "expected_display_name": "Joshua"  # Should find match via UUID
        }
    ]
    
    for test_case in test_cases:
        print(f"\n--- {test_case['name']} ---")
        
        # Simulate the template preview logic
        selected_user_ids = test_case['selected_user_ids']
        selected_removal_users = test_case['selected_removal_users']
        
        if selected_user_ids and len(selected_user_ids) == 1:
            user_id = selected_user_ids[0]
            display_name = None
            
            # Try to get display name from selected removal users first
            if selected_removal_users:
                for user_option in selected_removal_users:
                    option_user_id = user_option.split("(")[-1].rstrip(")")
                    # Handle both full Matrix ID and UUID-only matching
                    if option_user_id == user_id:
                        display_name = user_option.split("(")[0].strip()
                        # Remove emoji indicators like 📱 from display name
                        display_name = display_name.replace(" 📱", "").strip()
                        break
                    # Also check if the UUID part matches (for cases where user_id is UUID-only)
                    elif ":" in option_user_id and user_id in option_user_id:
                        display_name = user_option.split("(")[0].strip()
                        # Remove emoji indicators like 📱 from display name
                        display_name = display_name.replace(" 📱", "").strip()
                        break
                    # Also check if the user_id is full Matrix ID and option is UUID-only
                    elif ":" in user_id and option_user_id in user_id:
                        display_name = user_option.split("(")[0].strip()
                        # Remove emoji indicators like 📱 from display name
                        display_name = display_name.replace(" 📱", "").strip()
                        break
            
            # Final fallback to username
            if not display_name:
                display_name = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
            
            print(f"Input user_id: '{user_id}'")
            print(f"Selected removal users: {selected_removal_users}")
            print(f"Resolved display_name: '{display_name}'")
            print(f"Expected display_name: '{test_case['expected_display_name']}'")
            
            if display_name == test_case['expected_display_name']:
                print("✅ TEMPLATE PREVIEW TEST PASSED")
            else:
                print("❌ TEMPLATE PREVIEW TEST FAILED")

def test_message_execution_logic():
    print("\n\n=== TESTING MESSAGE EXECUTION LOGIC ===")
    
    # Test scenarios for message execution
    test_cases = [
        {
            "name": "Template with placeholder",
            "user_id": "@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com",
            "display_name": "Joshua",
            "removal_message": "Custom message for @{username}",
            "expected_plain": "Custom message for @Joshua",
            "expected_html": 'Custom message for @<a href="https://matrix.to/#/@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com" data-mention-type="user">Joshua</a>'
        },
        {
            "name": "Template with UUID fallback",
            "user_id": "@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com",
            "display_name": "Joshua",
            "removal_message": "Custom message for @signal_01383f13-1479-4058-b51b-d39244b679f4",
            "expected_plain": "Custom message for @Joshua",
            "expected_html": 'Custom message for @<a href="https://matrix.to/#/@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com" data-mention-type="user">Joshua</a>'
        },
        {
            "name": "Template with display name already",
            "user_id": "@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com",
            "display_name": "Joshua",
            "removal_message": "Custom message for @Joshua",
            "expected_plain": "Custom message for @Joshua",
            "expected_html": 'Custom message for @<a href="https://matrix.to/#/@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com" data-mention-type="user">Joshua</a>'
        },
        {
            "name": "UUID-only user ID with placeholder",
            "user_id": "signal_01383f13-1479-4058-b51b-d39244b679f4",
            "display_name": "Joshua",
            "removal_message": "Custom message for @{username}",
            "expected_plain": "Custom message for @Joshua",
            "expected_html": 'Custom message for @<a href="https://matrix.to/#/signal_01383f13-1479-4058-b51b-d39244b679f4" data-mention-type="user">Joshua</a>'
        },
        {
            "name": "UUID-only user ID with UUID in message",
            "user_id": "signal_01383f13-1479-4058-b51b-d39244b679f4",
            "display_name": "Joshua",
            "removal_message": "Custom message for @signal_01383f13-1479-4058-b51b-d39244b679f4",
            "expected_plain": "Custom message for @Joshua",
            "expected_html": 'Custom message for @<a href="https://matrix.to/#/signal_01383f13-1479-4058-b51b-d39244b679f4" data-mention-type="user">Joshua</a>'
        }
    ]
    
    for test_case in test_cases:
        print(f"\n--- {test_case['name']} ---")
        
        user_id = test_case['user_id']
        display_name = test_case['display_name']
        removal_message = test_case['removal_message']
        
        # Simulate the message execution logic
        mention_html = f'<a href="https://matrix.to/#/{user_id}" data-mention-type="user">{display_name}</a>'
        
        personalized_message = removal_message
        plain_text_body = removal_message
        
        # First, try to replace {username} placeholder if it exists
        if "{username}" in personalized_message:
            personalized_message = personalized_message.replace("{username}", mention_html)
            plain_text_body = plain_text_body.replace("{username}", display_name)
            print("  → Used placeholder replacement")
        else:
            # If no placeholder, the template preview already replaced it with a username
            # We need to replace that username with the correct display name
            username_fallback = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
            
            # Try multiple replacement strategies
            replaced = False
            
            # Strategy 1: Replace username fallback if it's different from display name
            if username_fallback in personalized_message and username_fallback != display_name:
                personalized_message = personalized_message.replace(f"@{username_fallback}", f"@{mention_html}")
                plain_text_body = plain_text_body.replace(f"@{username_fallback}", f"@{display_name}")
                print(f"  → Replaced username_fallback '{username_fallback}' with display_name '{display_name}'")
                replaced = True
            
            # Strategy 2: If the message already has the correct display name, just add HTML formatting
            elif f"@{display_name}" in personalized_message:
                personalized_message = personalized_message.replace(f"@{display_name}", f"@{mention_html}")
                print(f"  → Added HTML formatting to existing display_name '{display_name}'")
                replaced = True
            
            # Strategy 3: Handle UUID-only user IDs (without @)
            elif not replaced and ":" not in user_id:
                # For UUID-only IDs, try to replace the UUID directly
                if user_id in personalized_message:
                    personalized_message = personalized_message.replace(f"@{user_id}", f"@{mention_html}")
                    plain_text_body = plain_text_body.replace(f"@{user_id}", f"@{display_name}")
                    print(f"  → Replaced UUID-only '{user_id}' with display_name '{display_name}'")
                    replaced = True
            
            # Strategy 4: If nothing was replaced, log a warning
            if not replaced:
                print(f"  ⚠️ No replacement made for user_id '{user_id}', display_name '{display_name}', message: '{personalized_message}'")
        
        print(f"Input: '{removal_message}'")
        print(f"Plain text result: '{plain_text_body}'")
        print(f"HTML result: '{personalized_message}'")
        
        # Check results
        plain_match = plain_text_body == test_case['expected_plain']
        html_match = personalized_message == test_case['expected_html']
        
        print(f"Plain text correct: {plain_match}")
        print(f"HTML correct: {html_match}")
        
        if plain_match and html_match:
            print("✅ MESSAGE EXECUTION TEST PASSED")
        else:
            print("❌ MESSAGE EXECUTION TEST FAILED")
            if not plain_match:
                print(f"  Expected plain: '{test_case['expected_plain']}'")
                print(f"  Got plain:      '{plain_text_body}'")
            if not html_match:
                print(f"  Expected HTML: '{test_case['expected_html']}'")
                print(f"  Got HTML:      '{personalized_message}'")

if __name__ == "__main__":
    test_template_preview_logic()
    test_message_execution_logic() 