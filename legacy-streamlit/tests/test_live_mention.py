#!/usr/bin/env python3
"""
Live test script for mention formatting in Matrix room
Tests removal with mention and then adds user back
"""

import sys
import os
import asyncio
sys.path.append('app')

from app.utils.matrix_actions import (
    _send_room_message_with_content_async,
    remove_from_matrix_room_async,
    invite_to_matrix_room
)

async def test_live_mention_formatting():
    print("=== LIVE MENTION FORMATTING TEST ===")
    
    # Test configuration - EXAMPLE VALUES ONLY
    test_room_id = "!example123:example.com"  # Example Bot Development Room
    test_user_id = "@signal_example123:example.com"
    display_name = "Test User"
    
    print(f"Testing in room: {test_room_id}")
    print(f"Testing with user: {test_user_id}")
    print(f"Display name: {display_name}")
    print()
    
    print("⚠️  NOTE: This is a template for live testing.")
    print("⚠️  Update the room ID and user ID with real values before running.")
    print("⚠️  Ensure you have proper permissions in the target room.")
    print()
    
    # Test scenarios
    test_scenarios = [
        {
            "name": "Removal with mention",
            "message": f"🧪 TEST: @{display_name} is being removed for testing mention formatting. This is a test message and they will be re-added immediately.",
            "action": "remove"
        },
        {
            "name": "Re-invitation message", 
            "message": f"✅ TEST COMPLETE: @{display_name} has been re-added to the room. The mention formatting test is finished.",
            "action": "invite"
        }
    ]
    
    print("=== TEST SCENARIOS ===")
    for i, scenario in enumerate(test_scenarios, 1):
        print(f"{i}. {scenario['name']}")
        print(f"   Message: {scenario['message']}")
        print(f"   Action: {scenario['action']}")
        print()
    
    print("=== EXPECTED RESULTS ===")
    print("✅ Messages should show '@Test User' instead of '@signal_example123'")
    print("✅ Mentions should be clickable in Matrix clients")
    print("✅ User should receive notifications for mentions")
    print("✅ User removal and re-invitation should work properly")
    print()
    
    print("=== TO RUN LIVE TEST ===")
    print("1. Update test_room_id with a real room ID where you have admin permissions")
    print("2. Update test_user_id with a real user ID to test with")
    print("3. Update display_name with the user's actual display name")
    print("4. Ensure the Matrix bot has proper permissions")
    print("5. Run this script in an environment with Matrix credentials")
    print()
    
    print("⚠️  SAFETY REMINDER:")
    print("   - Only test with consenting users")
    print("   - Use a dedicated test room")
    print("   - Ensure you can re-add users immediately")
    print("   - Have proper admin permissions")

if __name__ == "__main__":
    asyncio.run(test_live_mention_formatting()) 