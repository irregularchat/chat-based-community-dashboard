#!/usr/bin/env python3
"""
Test script to send a message to Sac via Signal bridge.
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from app.utils.matrix_actions import create_matrix_direct_chat, send_matrix_message

async def test_message_to_sac():
    print("🧪 Testing message to Sac via Signal bridge...")
    
    # Test with Sac's Signal user ID
    sac_signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    test_message = "🧪 Test message from dashboard to Sac - checking Signal bridge functionality!"
    
    print(f"\n🎯 Testing Signal user: {sac_signal_user}")
    print(f"📝 Message: {test_message}")
    print("\nThis should:")
    print("1. Detect Sac as a Signal bridge user")
    print("2. Search for existing Signal bridge room with topic 'Signal private chat'")
    print("3. Send message to the correct Signal bridge room")
    print("4. Message should reach Sac via Signal app")
    
    try:
        # Step 1: Get the Signal chat room for Sac
        print(f"\n📍 Step 1: Finding Signal chat room for Sac...")
        room_id = await create_matrix_direct_chat(sac_signal_user)
        
        if room_id:
            print(f"✅ Got Signal chat room ID: {room_id}")
        else:
            print(f"❌ FAILED: Could not get Signal chat room for Sac")
            return
        
        # Step 2: Send the message
        print(f"\n📍 Step 2: Sending message to Sac's Signal chat room...")
        print(f"   - Target room: {room_id}")
        
        success = await send_matrix_message(room_id, test_message)
        
        if success:
            print(f"✅ SUCCESS: Message sent successfully!")
            print(f"📱 Sac should receive this message in their Signal app")
            print(f"🔍 Check the Matrix room to see if message appears correctly")
        else:
            print(f"❌ FAILED: Message sending failed")
            
    except Exception as e:
        print(f"❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test_message_to_sac()) 