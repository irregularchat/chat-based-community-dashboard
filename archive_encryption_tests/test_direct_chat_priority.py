#!/usr/bin/env python3
"""
Test script to verify improved logic prioritizes true direct chats over group rooms.
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from app.utils.matrix_actions import create_matrix_direct_chat

async def test_direct_chat_priority():
    print("🧪 Testing direct chat priority logic...")
    
    # Test with the Signal user that had the group room issue
    signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Testing Signal user: {signal_user}")
    print("This should now:")
    print("1. Send 'start-chat XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX' command to Signal bridge bot")
    print("2. Search through joined rooms with improved priority logic")
    print("3. PRIORITIZE rooms with exactly 2 members (bot + Signal user)")
    print("4. SKIP rooms with 3+ members that have 'test', 'bot', 'group' in the name")
    print("5. Find the actual direct chat room, not group rooms")
    
    try:
        room_id = await create_matrix_direct_chat(signal_user)
        
        if room_id:
            print(f"✅ SUCCESS: Got chat room ID: {room_id}")
            
            # Check if it's the fallback room or a real room
            if room_id == "!XXXXXXXXXXXXXXXXXX:example.com":
                print("📝 Using fallback room (this is OK for existing users)")
            else:
                print(f"📝 Found specific room for this Signal user: {room_id}")
                
            # Check if it's the same problematic room as before
            if room_id == "!YYYYYYYYYYYYYYYYYY:example.com":
                print("⚠️  WARNING: This is the same 'bot test self' room from before!")
                print("   This suggests it might still be finding a group room instead of direct chat")
            else:
                print("✅ GOOD: Found a different room, likely the correct direct chat")
                
        else:
            print(f"❌ FAILED: create_matrix_direct_chat returned None")
            
    except Exception as e:
        print(f"❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test_direct_chat_priority()) 