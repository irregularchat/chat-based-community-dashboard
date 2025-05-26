#!/usr/bin/env python3
"""
Test script to verify the mention formatting fix
"""

def test_mention_replacement():
    print("=== TESTING MENTION REPLACEMENT LOGIC ===")
    
    # Test data
    user_id = "@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com"
    display_name = "Joshua"
    username_fallback = "signal_01383f13-1479-4058-b51b-d39244b679f4"
    
    # Test scenarios
    test_cases = [
        {
            "name": "Template with placeholder",
            "removal_message": "Custom message for @{username}",
            "expected_plain": "Custom message for @Joshua",
            "expected_html": 'Custom message for @<a href="https://matrix.to/#/@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com" data-mention-type="user">Joshua</a>'
        },
        {
            "name": "Template with username fallback",
            "removal_message": "Custom message for @signal_01383f13-1479-4058-b51b-d39244b679f4",
            "expected_plain": "Custom message for @Joshua",
            "expected_html": 'Custom message for @<a href="https://matrix.to/#/@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com" data-mention-type="user">Joshua</a>'
        },
        {
            "name": "Template already with display name",
            "removal_message": "Custom message for @Joshua",
            "expected_plain": "Custom message for @Joshua",
            "expected_html": 'Custom message for @<a href="https://matrix.to/#/@signal_01383f13-1479-4058-b51b-d39244b679f4:irregularchat.com" data-mention-type="user">Joshua</a>'
        }
    ]
    
    for test_case in test_cases:
        print(f"\n--- {test_case['name']} ---")
        removal_message = test_case['removal_message']
        print(f"Input: '{removal_message}'")
        
        # Simulate the logic from the fixed code
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
            
            # Replace the username fallback with display name in both HTML and plain text
            if username_fallback in personalized_message and username_fallback != display_name:
                personalized_message = personalized_message.replace(f"@{username_fallback}", f"@{mention_html}")
                plain_text_body = plain_text_body.replace(f"@{username_fallback}", f"@{display_name}")
                print(f"  → Replaced username_fallback '{username_fallback}' with display_name '{display_name}'")
            else:
                # If the message already has the correct display name, just add HTML formatting
                personalized_message = personalized_message.replace(f"@{display_name}", f"@{mention_html}")
                print("  → Added HTML formatting to existing display name")
        
        print(f"Plain text result: '{plain_text_body}'")
        print(f"HTML result: '{personalized_message}'")
        
        # Check results
        plain_match = plain_text_body == test_case['expected_plain']
        html_match = personalized_message == test_case['expected_html']
        
        print(f"Plain text correct: {plain_match}")
        print(f"HTML correct: {html_match}")
        
        if plain_match and html_match:
            print("✅ TEST PASSED")
        else:
            print("❌ TEST FAILED")
            if not plain_match:
                print(f"  Expected plain: '{test_case['expected_plain']}'")
                print(f"  Got plain:      '{plain_text_body}'")
            if not html_match:
                print(f"  Expected HTML: '{test_case['expected_html']}'")
                print(f"  Got HTML:      '{personalized_message}'")

if __name__ == "__main__":
    test_mention_replacement() 