#!/usr/bin/env python3
"""
Test script to verify the fixed message history function can properly detect encrypted messages.
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_direct_message_history

async def test_fixed_message_history():
    print("🧪 Testing fixed message history with proper event type detection...")
    print("🔍 This should now properly detect MegolmEvent (encrypted) messages from Sac")
    
    # Test with Sac's Signal user ID
    sac_signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Getting message history with: {sac_signal_user}")
    print("Expected results:")
    print("1. ✅ Detect MegolmEvent messages as encrypted")
    print("2. ✅ Show proper event types from source data")
    print("3. ✅ Display encrypted messages with proper status")
    print("4. ✅ Show Sac's 4-digit number response (if decrypted)")
    
    try:
        # Get message history using the fixed function
        messages = await get_direct_message_history(sac_signal_user, limit=10)
        
        if not messages:
            print("❌ No messages found")
            return
        
        print(f"\n✅ Retrieved {len(messages)} messages")
        print("="*60)
        
        # Display each message with detailed analysis
        for i, msg in enumerate(messages, 1):
            print(f"\n📨 Message {i}:")
            print(f"   Sender: {msg.get('sender', 'Unknown')}")
            print(f"   Content: {msg.get('content', 'No content')}")
            print(f"   Event Type: {msg.get('event_type', 'Unknown')}")
            print(f"   Decryption Status: {msg.get('decryption_status', 'Unknown')}")
            print(f"   Timestamp: {msg.get('formatted_time', 'Unknown')}")
            print(f"   Is Bot Message: {msg.get('is_bot_message', False)}")
            
            # Special attention to Sac's messages
            if msg.get('sender') == sac_signal_user:
                print(f"   🎯 THIS IS FROM SAC!")
                content = msg.get('content', '')
                if content.strip().isdigit() and len(content.strip()) == 4:
                    print(f"   🔢 FOUND 4-DIGIT NUMBER: {content}")
                elif 'encrypted' in content.lower():
                    print(f"   🔐 ENCRYPTED MESSAGE - needs decryption")
            
            print(f"   " + "-"*50)
        
        # Summary statistics
        print(f"\n📊 Summary Statistics:")
        total_messages = len(messages)
        sac_messages = len([m for m in messages if m.get('sender') == sac_signal_user])
        bot_messages = len([m for m in messages if m.get('is_bot_message')])
        encrypted_messages = len([m for m in messages if 'encrypted' in m.get('decryption_status', '').lower()])
        
        print(f"   Total messages: {total_messages}")
        print(f"   Messages from Sac: {sac_messages}")
        print(f"   Messages from bot: {bot_messages}")
        print(f"   Encrypted messages: {encrypted_messages}")
        
        # Check for 4-digit numbers
        four_digit_messages = []
        for msg in messages:
            content = msg.get('content', '')
            if content.strip().isdigit() and len(content.strip()) == 4:
                four_digit_messages.append(msg)
        
        if four_digit_messages:
            print(f"\n🎯 Found {len(four_digit_messages)} messages with 4-digit numbers:")
            for msg in four_digit_messages:
                print(f"   From {msg.get('sender')}: {msg.get('content')} (Status: {msg.get('decryption_status')})")
        else:
            print(f"\n🔍 No 4-digit numbers found yet - may need decryption")
        
        print(f"\n✅ Test completed successfully!")
        
    except Exception as e:
        print(f"❌ Error during test: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_fixed_message_history()) 