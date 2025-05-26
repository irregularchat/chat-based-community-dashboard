#!/usr/bin/env python3
"""
Test script to get raw room messages to debug message history retrieval.
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_matrix_client

async def test_raw_room_messages():
    print("🧪 Testing raw room messages retrieval...")
    
    # Use the room ID we know contains Sac's messages
    room_id = "!XXXXXXXXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Getting raw messages from room: {room_id}")
    print("This should show all messages in the room, including encrypted ones")
    
    try:
        # Get Matrix client
        client = await get_matrix_client()
        if not client:
            print("❌ Failed to create Matrix client")
            return
        
        try:
            # Get raw room messages
            print(f"\n📍 Retrieving raw room messages...")
            response = await client.room_messages(room_id, limit=20)
            
            if hasattr(response, 'chunk'):
                messages = response.chunk
                print(f"✅ SUCCESS: Retrieved {len(messages)} raw messages")
                
                if messages:
                    print(f"\n📜 Raw Messages:")
                    print("=" * 80)
                    
                    for i, event in enumerate(messages, 1):
                        print(f"\n{i}. Event Type: {getattr(event, 'type', 'Unknown')}")
                        print(f"   Sender: {getattr(event, 'sender', 'Unknown')}")
                        print(f"   Event ID: {getattr(event, 'event_id', 'Unknown')}")
                        
                        # Check if it's a message event
                        if hasattr(event, 'msgtype'):
                            print(f"   Message Type: {event.msgtype}")
                            if hasattr(event, 'body'):
                                print(f"   Content: {event.body}")
                            else:
                                print(f"   Content: [No body - might be encrypted]")
                        elif hasattr(event, 'type') and event.type == 'm.room.encrypted':
                            print(f"   Content: [ENCRYPTED MESSAGE]")
                        else:
                            print(f"   Content: [Non-message event]")
                        
                        # Check for timestamp
                        if hasattr(event, 'server_timestamp'):
                            import datetime
                            dt = datetime.datetime.fromtimestamp(event.server_timestamp / 1000)
                            print(f"   Timestamp: {dt.strftime('%Y-%m-%d %H:%M:%S')}")
                    
                    print("=" * 80)
                    
                    # Count message types
                    text_messages = [e for e in messages if hasattr(e, 'msgtype') and e.msgtype == 'm.text']
                    encrypted_messages = [e for e in messages if hasattr(e, 'type') and e.type == 'm.room.encrypted']
                    
                    print(f"\n📊 Message Analysis:")
                    print(f"   - Total events: {len(messages)}")
                    print(f"   - Text messages: {len(text_messages)}")
                    print(f"   - Encrypted messages: {len(encrypted_messages)}")
                    
                    if encrypted_messages:
                        print(f"   ⚠️  Room contains encrypted messages - this explains why history retrieval returned 0 messages")
                        print(f"   💡 The message history feature may need encryption support to read Signal bridge messages")
                    
                else:
                    print(f"❌ No messages found in room")
            else:
                print(f"❌ Invalid response format: {response}")
                
        finally:
            await client.close()
            
    except Exception as e:
        print(f"❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test_raw_room_messages()) 