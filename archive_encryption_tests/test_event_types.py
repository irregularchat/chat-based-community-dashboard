#!/usr/bin/env python3
"""
Test script to examine raw event data and understand why events show as "Unknown" type.
"""
import asyncio
import sys
import json
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_matrix_client
from app.utils.config import Config

async def test_event_types():
    print("🧪 Testing event types and raw data...")
    print("🔍 Examining why events show as 'Unknown' instead of encrypted types")
    
    # Use the room ID we know contains Sac's messages
    room_id = "!XXXXXXXXXXXXXXXXXX:example.com"
    sac_signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Target room: {room_id}")
    print(f"🎯 Target user: {sac_signal_user}")
    
    try:
        # Create Matrix client
        client = await get_matrix_client()
        if not client:
            print("❌ Failed to create Matrix client")
            return
        
        try:
            print("\n📡 Performing sync...")
            sync_response = await client.sync(timeout=5000, full_state=True)
            print(f"✅ Sync completed: {type(sync_response).__name__}")
            
            # Get room messages
            print(f"\n📨 Retrieving messages from room...")
            response = await client.room_messages(room_id, limit=5)
            
            if not hasattr(response, 'chunk'):
                print("❌ No messages chunk in response")
                return
            
            print(f"✅ Retrieved {len(response.chunk)} events")
            
            # Examine each event in detail
            for i, event in enumerate(response.chunk):
                event_num = i + 1
                print(f"\n🔍 Event {event_num} - Detailed Analysis:")
                
                # Basic event info
                event_type = getattr(event, 'type', 'NO_TYPE_ATTR')
                sender = getattr(event, 'sender', 'NO_SENDER_ATTR')
                event_id = getattr(event, 'event_id', 'NO_EVENT_ID_ATTR')
                
                print(f"   Type: {event_type}")
                print(f"   Sender: {sender}")
                print(f"   Event ID: {event_id}")
                
                # Check all attributes of the event
                print(f"   Available attributes: {dir(event)}")
                
                # Try to access raw event data if available
                if hasattr(event, 'source'):
                    print(f"   Raw source data: {json.dumps(event.source, indent=2)}")
                elif hasattr(event, 'raw'):
                    print(f"   Raw data: {json.dumps(event.raw, indent=2)}")
                elif hasattr(event, '__dict__'):
                    print(f"   Event dict: {event.__dict__}")
                
                # Check for specific encrypted event attributes
                if hasattr(event, 'algorithm'):
                    print(f"   Algorithm: {event.algorithm}")
                if hasattr(event, 'ciphertext'):
                    print(f"   Has ciphertext: Yes")
                if hasattr(event, 'session_id'):
                    print(f"   Session ID: {event.session_id}")
                if hasattr(event, 'device_id'):
                    print(f"   Device ID: {event.device_id}")
                
                # Check for message content
                if hasattr(event, 'body'):
                    print(f"   Body: {event.body}")
                if hasattr(event, 'content'):
                    print(f"   Content: {event.content}")
                
                # Check the actual class type
                print(f"   Python class: {type(event).__name__}")
                print(f"   Module: {type(event).__module__}")
                
                # If this is from Sac, pay special attention
                if sender == sac_signal_user:
                    print(f"   🎯 THIS IS FROM SAC - SPECIAL ATTENTION")
                    
                    # Try different ways to access the content
                    print(f"   Trying different content access methods:")
                    
                    # Method 1: Direct attributes
                    for attr in ['body', 'content', 'formatted_body', 'msgtype']:
                        if hasattr(event, attr):
                            value = getattr(event, attr)
                            print(f"     {attr}: {value}")
                    
                    # Method 2: Check if it's a MegolmEvent that needs decryption
                    if type(event).__name__ == 'MegolmEvent':
                        print(f"     This is a MegolmEvent (encrypted)")
                        if hasattr(event, 'decrypted_event'):
                            decrypted = event.decrypted_event
                            if decrypted:
                                print(f"     Decrypted event available: {type(decrypted).__name__}")
                                if hasattr(decrypted, 'body'):
                                    print(f"     Decrypted body: {decrypted.body}")
                            else:
                                print(f"     No decrypted event available")
                
                print(f"   " + "="*50)
            
        finally:
            await client.close()
            
    except Exception as e:
        print(f"❌ Error during event type analysis: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_event_types()) 