#!/usr/bin/env python3
"""
Test script to try to decrypt messages and see actual content.
"""
import asyncio
import sys
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_matrix_client

async def test_decrypt_messages():
    print("🧪 Testing message decryption...")
    
    # Use the room ID we know contains Sac's messages
    room_id = "!XXXXXXXXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Attempting to decrypt messages from room: {room_id}")
    print("This should show decrypted message content if encryption is working")
    
    try:
        # Get Matrix client
        client = await get_matrix_client()
        if not client:
            print("❌ Failed to create Matrix client")
            return
        
        try:
            # Get raw room messages
            print(f"\n📍 Retrieving and attempting to decrypt messages...")
            response = await client.room_messages(room_id, limit=10)
            
            if hasattr(response, 'chunk'):
                messages = response.chunk
                print(f"✅ SUCCESS: Retrieved {len(messages)} events")
                
                if messages:
                    print(f"\n📜 Decrypted Messages:")
                    print("=" * 80)
                    
                    for i, event in enumerate(messages, 1):
                        print(f"\n{i}. Event ID: {getattr(event, 'event_id', 'Unknown')}")
                        print(f"   Sender: {getattr(event, 'sender', 'Unknown')}")
                        print(f"   Type: {getattr(event, 'type', 'Unknown')}")
                        
                        # Check for timestamp
                        if hasattr(event, 'server_timestamp'):
                            import datetime
                            dt = datetime.datetime.fromtimestamp(event.server_timestamp / 1000)
                            print(f"   Timestamp: {dt.strftime('%Y-%m-%d %H:%M:%S')}")
                        
                        # Try to get decrypted content
                        if hasattr(event, 'type'):
                            if event.type == 'm.room.message':
                                # Regular message
                                if hasattr(event, 'body'):
                                    print(f"   💬 Content: {event.body}")
                                    
                                    # Check if this looks like Sac's 4-digit response
                                    if (event.sender == "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com" 
                                        and event.body.strip().isdigit() and len(event.body.strip()) == 4):
                                        print(f"   🎯 FOUND: This looks like Sac's 4-digit number response!")
                                else:
                                    print(f"   💬 Content: [No body available]")
                            elif event.type == 'm.room.encrypted':
                                print(f"   🔒 Content: [ENCRYPTED - attempting to decrypt]")
                                
                                # Try to access decrypted content
                                if hasattr(event, 'decrypted_event'):
                                    decrypted = event.decrypted_event
                                    if hasattr(decrypted, 'body'):
                                        print(f"   💬 Decrypted: {decrypted.body}")
                                        
                                        # Check if this looks like Sac's 4-digit response
                                        if (event.sender == "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com" 
                                            and decrypted.body.strip().isdigit() and len(decrypted.body.strip()) == 4):
                                            print(f"   🎯 FOUND: This looks like Sac's 4-digit number response!")
                                    else:
                                        print(f"   💬 Decrypted: [No body in decrypted event]")
                                else:
                                    print(f"   💬 Decrypted: [Unable to decrypt]")
                            else:
                                print(f"   ℹ️  Content: [Non-message event: {event.type}]")
                        else:
                            print(f"   ❓ Content: [Unknown event structure]")
                            
                        # Try to access any available content attributes
                        for attr in ['body', 'content', 'formatted_body']:
                            if hasattr(event, attr):
                                value = getattr(event, attr)
                                if value and attr not in ['body']:  # Don't duplicate body
                                    print(f"   📝 {attr}: {value}")
                    
                    print("=" * 80)
                    
                    # Look for recent messages from Sac
                    sac_events = [e for e in messages if getattr(e, 'sender', '') == "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"]
                    
                    print(f"\n📊 Analysis:")
                    print(f"   - Total events: {len(messages)}")
                    print(f"   - Events from Sac: {len(sac_events)}")
                    
                    if sac_events:
                        print(f"   ✅ Found {len(sac_events)} events from Sac")
                        print(f"   📅 Most recent Sac event: {datetime.datetime.fromtimestamp(sac_events[0].server_timestamp / 1000).strftime('%Y-%m-%d %H:%M:%S')}")
                    else:
                        print(f"   ⚠️  No events from Sac found in recent messages")
                    
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
    asyncio.run(test_decrypt_messages()) 