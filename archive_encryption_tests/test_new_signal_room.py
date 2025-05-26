#!/usr/bin/env python3
"""
Test script to verify messages work correctly with the new Signal direct chat room approach.
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from app.utils.matrix_actions import create_matrix_direct_chat, send_matrix_message

async def test_new_signal_room():
    print("🧪 Testing new Signal direct chat room approach...")
    
    # Test with the Signal user
    signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    test_message = "🧪 Test message to NEW Signal direct chat room - should be a clean direct message!"
    
    print(f"\n🎯 Testing Signal user: {signal_user}")
    print(f"📝 Message: {test_message}")
    print("\nThis should:")
    print("1. Create a fresh direct chat room for the Signal user")
    print("2. Send the message to that specific room")
    print("3. Avoid any group rooms or community rooms")
    print("4. Result in a clean direct message experience")
    
    try:
        # Step 1: Get/create the Signal chat room
        print(f"\n📍 Step 1: Creating Signal direct chat room...")
        room_id = await create_matrix_direct_chat(signal_user)
        
        if room_id:
            print(f"✅ Got Signal chat room ID: {room_id}")
            
            # Verify it's a new room (not the old problematic ones)
            if room_id == "!YYYYYYYYYYYYYYYYYY:example.com":
                print("❌ ERROR: Still using the old 'bot test self' room!")
            elif room_id == "!XXXXXXXXXXXXXXXXXX:example.com":
                print("⚠️  WARNING: Using fallback room")
            else:
                print("✅ GOOD: Using a new dedicated room for this Signal user")
                
        else:
            print(f"❌ FAILED: Could not get Signal chat room")
            return
        
        # Step 2: Send the message
        print(f"\n📍 Step 2: Sending message to Signal direct chat room...")
        print(f"   - Target room: {room_id}")
        
        success = await send_matrix_message(room_id, test_message)
        
        if success:
            print(f"✅ SUCCESS: Message sent successfully!")
            print(f"📱 This should appear as a direct message to the Signal user")
            print(f"🚫 Should NOT appear in any group rooms or community rooms")
        else:
            print(f"❌ FAILED: Message sending failed")
            
    except Exception as e:
        print(f"❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test_new_signal_room()) 