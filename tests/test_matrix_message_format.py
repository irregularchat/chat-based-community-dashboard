#!/usr/bin/env python3
"""
Test script to show the exact Matrix message format that would be sent
Demonstrates the mention formatting without making actual Matrix calls
"""

import json

def test_matrix_message_format():
    print("=== MATRIX MESSAGE FORMAT TEST ===")
    print("This shows exactly what would be sent to the Matrix room")
    print("Room: !example123:example.com (Example Bot Development)")
    print()
    
    # Test user
    user_id = "@signal_example123:example.com"
    display_name = "Test User"
    
    # Create the mention HTML (this is what makes the mention show as "@Test User")
    mention_html = f'<a href="https://matrix.to/#/{user_id}" data-mention-type="user">@{display_name}</a>'
    
    # Test message scenarios
    test_scenarios = [
        {
            "name": "Removal Message with Mention",
            "plain_text": f"Custom message for @{display_name}",
            "html_text": f"Custom message for {mention_html}",
            "mentions": [user_id]
        },
        {
            "name": "Welcome Message with Mention", 
            "plain_text": f"Welcome @{display_name} to the community!",
            "html_text": f"Welcome {mention_html} to the community!",
            "mentions": [user_id]
        }
    ]
    
    for scenario in test_scenarios:
        print(f"--- {scenario['name']} ---")
        
        # Create the Matrix message content
        message_content = {
            "msgtype": "m.text",
            "body": scenario["plain_text"],
            "format": "org.matrix.custom.html", 
            "formatted_body": scenario["html_text"],
            "m.mentions": {
                "user_ids": scenario["mentions"]
            }
        }
        
        print("Matrix Message Content:")
        print(json.dumps(message_content, indent=2))
        print()
        
        print("What users see:")
        print(f"  Plain text clients: {scenario['plain_text']}")
        print(f"  Rich clients: {display_name} gets a notification and sees clickable mention")
        print()
    
    print("=== KEY BENEFITS ===")
    print("✅ Users see display names (@Test User) instead of UUIDs")
    print("✅ Mentions are clickable in Matrix clients")
    print("✅ Users receive proper notifications")
    print("✅ Follows Matrix mention protocol standards")
    print()
    print("✅ Messages will show '@Test User' instead of '@signal_example123'")

if __name__ == "__main__":
    test_matrix_message_format() 