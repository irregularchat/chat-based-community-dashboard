#!/usr/bin/env python3
"""
Test script to simulate the UI mention formatting logic
Tests the exact logic used in the Matrix UI without making actual Matrix calls
"""

import sys
import os
sys.path.append('app')

def test_ui_mention_logic():
    print("=== TESTING UI MENTION FORMATTING LOGIC ===")
    
    # Simulate the session state and user selection scenarios
    test_scenarios = [
        {
            "name": "UI Selection: Full Matrix ID with display name",
            "selected_removal_users": ["Test User 📱 (@signal_example123:example.com)"],
            "selected_user_ids": ["@signal_example123:example.com"],
            "removal_message": "Custom message for @{username}",
            "expected_display_name": "Test User",
            "expected_plain": "Custom message for @Test User",
            "expected_html": 'Custom message for <a href="https://matrix.to/#/@signal_example123:example.com" data-mention-type="user">@Test User</a>'
        },
        {
            "name": "Manual Entry: UUID-only with fallback",
            "selected_removal_users": [],
            "selected_user_ids": ["signal_example123"],
            "removal_message": "Custom message for @{username}",
            "expected_display_name": "signal_example123",
            "expected_plain": "Custom message for @signal_example123",
            "expected_html": 'Custom message for <a href="https://matrix.to/#/signal_example123" data-mention-type="user">@signal_example123</a>'
        },
        {
            "name": "Template Preview: Already replaced with UUID",
            "selected_removal_users": ["Test User 📱 (@signal_example123:example.com)"],
            "selected_user_ids": ["@signal_example123:example.com"],
            "removal_message": "Custom message for @signal_example123",
            "expected_display_name": "Test User",
            "expected_plain": "Custom message for @Test User",
            "expected_html": 'Custom message for <a href="https://matrix.to/#/@signal_example123:example.com" data-mention-type="user">@Test User</a>'
        }
    ]
    
    for scenario in test_scenarios:
        print(f"\n--- {scenario['name']} ---")
        
        # Step 1: Simulate display name mapping (from UI logic)
        user_id_to_display_name = {}
        selected_user_ids = scenario['selected_user_ids']
        selected_removal_users = scenario['selected_removal_users']
        
        # Map display names from selected users (UI selection)
        for user_option in selected_removal_users:
            option_user_id = user_option.split("(")[-1].rstrip(")")
            display_name = user_option.split("(")[0].strip()
            # Remove emoji indicators like 📱 from display name
            display_name = display_name.replace(" 📱", "").strip()
            user_id_to_display_name[option_user_id] = display_name
            
            # Also map the UUID-only version (without domain) for robustness
            if ":" in option_user_id:
                uuid_only = option_user_id.split(":")[0].lstrip("@")
                user_id_to_display_name[uuid_only] = display_name
        
        # For any user_ids not in the mapping (manual entry), use fallback
        for user_id in selected_user_ids:
            if user_id not in user_id_to_display_name:
                # Fallback to username
                fallback_username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                user_id_to_display_name[user_id] = fallback_username
        
        # Step 2: Process the message for the first user
        user_id = selected_user_ids[0]
        display_name = user_id_to_display_name.get(user_id)
        
        # If we didn't find a display name and the user_id doesn't have a domain,
        # try to construct the full Matrix ID and look it up
        if display_name == user_id.split(":")[0].lstrip("@") and ":" not in user_id:
            # Try to construct full Matrix ID with example.com domain
            full_user_id = f"@{user_id}:example.com" if not user_id.startswith("@") else f"{user_id}:example.com"
            display_name = user_id_to_display_name.get(full_user_id, display_name)
        
        print(f"User ID: {user_id}")
        print(f"Resolved display name: {display_name}")
        print(f"Expected display name: {scenario['expected_display_name']}")
        
        # Step 3: Create mention HTML and process message (FIXED: include @ in mention_html)
        mention_html = f'<a href="https://matrix.to/#/{user_id}" data-mention-type="user">@{display_name}</a>'
        
        removal_message = scenario['removal_message']
        personalized_message = removal_message
        plain_text_body = removal_message
        
        # First, try to replace {username} placeholder if it exists
        if "{username}" in personalized_message:
            # For placeholder replacement, we need to replace @{username} with mention_html (which already contains @)
            personalized_message = personalized_message.replace("@{username}", mention_html)
            plain_text_body = plain_text_body.replace("@{username}", f"@{display_name}")
            print("→ Used placeholder replacement")
        else:
            # If no placeholder, try multiple replacement strategies
            username_fallback = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
            
            replaced = False
            
            # Strategy 1: Replace username fallback if it's different from display name
            if username_fallback in personalized_message and username_fallback != display_name:
                personalized_message = personalized_message.replace(f"@{username_fallback}", mention_html)
                plain_text_body = plain_text_body.replace(f"@{username_fallback}", f"@{display_name}")
                print(f"→ Replaced username_fallback '{username_fallback}' with display_name '{display_name}'")
                replaced = True
            
            # Strategy 2: If the message already has the correct display name, just add HTML formatting
            elif f"@{display_name}" in personalized_message:
                personalized_message = personalized_message.replace(f"@{display_name}", mention_html)
                print(f"→ Added HTML formatting to existing display_name '{display_name}'")
                replaced = True
            
            # Strategy 3: Handle UUID-only user IDs (without @)
            elif not replaced and ":" not in user_id:
                # For UUID-only IDs, try to replace the UUID directly
                if user_id in personalized_message:
                    personalized_message = personalized_message.replace(f"@{user_id}", mention_html)
                    plain_text_body = plain_text_body.replace(f"@{user_id}", f"@{display_name}")
                    print(f"→ Replaced UUID-only '{user_id}' with display_name '{display_name}'")
                    replaced = True
            
            if not replaced:
                print(f"⚠️ No replacement made")
        
        print(f"Original message: '{removal_message}'")
        print(f"Plain text result: '{plain_text_body}'")
        print(f"HTML result: '{personalized_message}'")
        
        # Step 4: Check results
        display_name_correct = display_name == scenario['expected_display_name']
        plain_correct = plain_text_body == scenario['expected_plain']
        html_correct = personalized_message == scenario['expected_html']
        
        print(f"\nResults:")
        print(f"Display name correct: {'✅' if display_name_correct else '❌'}")
        print(f"Plain text correct: {'✅' if plain_correct else '❌'}")
        print(f"HTML correct: {'✅' if html_correct else '❌'}")
        
        if display_name_correct and plain_correct and html_correct:
            print("🎉 SCENARIO PASSED")
        else:
            print("❌ SCENARIO FAILED")
            if not display_name_correct:
                print(f"  Expected display name: '{scenario['expected_display_name']}'")
                print(f"  Got display name:      '{display_name}'")
            if not plain_correct:
                print(f"  Expected plain: '{scenario['expected_plain']}'")
                print(f"  Got plain:      '{plain_text_body}'")
            if not html_correct:
                print(f"  Expected HTML: '{scenario['expected_html']}'")
                print(f"  Got HTML:      '{personalized_message}'")
    
    print("\n=== UI MENTION LOGIC TEST COMPLETE ===")

if __name__ == "__main__":
    test_ui_mention_logic() 