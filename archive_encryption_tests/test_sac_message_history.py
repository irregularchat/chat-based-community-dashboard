#!/usr/bin/env python3
"""
Test script to retrieve message history with Sac and confirm we can see their response.
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_direct_message_history_sync

async def test_sac_message_history():
    print("🧪 Testing message history with Sac...")
    
    # Test with Sac's Signal user ID
    sac_signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Getting message history with: {sac_signal_user}")
    print("This should show:")
    print("1. Our test message sent to Sac")
    print("2. Sac's response with a 4-digit number")
    print("3. Proper timestamps and sender information")
    
    try:
        # Get message history with Sac
        print(f"\n📍 Retrieving message history...")
        messages = get_direct_message_history_sync(sac_signal_user, limit=10)
        
        if messages:
            print(f"✅ SUCCESS: Retrieved {len(messages)} messages from conversation")
            print(f"\n📜 Message History:")
            print("=" * 80)
            
            for i, msg in enumerate(messages, 1):
                sender = msg.get('sender', 'Unknown')
                content = msg.get('content', '')
                timestamp = msg.get('formatted_time', 'Unknown time')
                is_bot = msg.get('is_bot_message', False)
                
                # Format sender name
                if is_bot:
                    sender_name = "🤖 IrregularChat Bot"
                elif sender == sac_signal_user:
                    sender_name = "📱 Sac (Signal)"
                else:
                    sender_name = f"👤 {sender}"
                
                print(f"\n{i}. [{timestamp}] {sender_name}:")
                print(f"   💬 {content}")
                
                # Check if this looks like Sac's 4-digit response
                if sender == sac_signal_user and content.isdigit() and len(content) == 4:
                    print(f"   🎯 FOUND: This looks like Sac's 4-digit number response!")
            
            print("=" * 80)
            
            # Summary
            bot_messages = [m for m in messages if m.get('is_bot_message')]
            sac_messages = [m for m in messages if m.get('sender') == sac_signal_user]
            
            print(f"\n📊 Summary:")
            print(f"   - Total messages: {len(messages)}")
            print(f"   - Bot messages: {len(bot_messages)}")
            print(f"   - Sac's messages: {len(sac_messages)}")
            
            if sac_messages:
                print(f"   ✅ Confirmed: Can see Sac's responses in message history!")
            else:
                print(f"   ⚠️  No messages from Sac found yet (may need to wait for sync)")
                
        else:
            print(f"❌ No message history found with Sac")
            print(f"   This could mean:")
            print(f"   - Messages haven't synced yet")
            print(f"   - Room ID detection issue")
            print(f"   - No conversation exists yet")
            
    except Exception as e:
        print(f"❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test_sac_message_history()) 