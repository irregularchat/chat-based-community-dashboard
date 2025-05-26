#!/usr/bin/env python3
"""
Test script specifically for decrypting MegolmEvent (encrypted) messages.
Focuses on the actual message content decryption using matrix-nio's built-in capabilities.
"""
import asyncio
import sys
import os
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_matrix_client
from app.utils.config import Config

async def test_megolm_decryption():
    print("🧪 Testing MegolmEvent decryption for Sac's messages...")
    print("🔑 Using enhanced Matrix client with encryption support")
    
    # Use the room ID we know contains Sac's messages
    room_id = "!XXXXXXXXXXXXXXXXXX:example.com"
    sac_signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Target room: {room_id}")
    print(f"🎯 Target user: {sac_signal_user}")
    print(f"🔐 Security key configured: {'Yes' if Config.MATRIX_SECURITY_KEY else 'No'}")
    print(f"🔐 Recovery passphrase configured: {'Yes' if Config.MATRIX_RECOVERY_PASSPHRASE else 'No'}")
    print(f"🗂️  Store path configured: {'Yes' if Config.MATRIX_STORE_PATH else 'No'}")
    
    try:
        # Create Matrix client with full encryption support
        client = await get_matrix_client()
        if not client:
            print("❌ Failed to create Matrix client")
            return
        
        try:
            print("\n📡 Performing comprehensive sync for encryption keys...")
            
            # Perform multiple syncs to ensure we have all encryption keys
            for i in range(3):
                print(f"   Sync {i+1}/3...")
                sync_response = await client.sync(timeout=5000, full_state=True)
                print(f"   ✅ Sync {i+1} completed: {type(sync_response).__name__}")
            
            # Check if we have the room
            if room_id not in client.rooms:
                print(f"❌ Room {room_id} not found in client rooms")
                return
            
            room = client.rooms[room_id]
            print(f"✅ Found room: {room.display_name or room.name or 'Unnamed'}")
            print(f"   Members: {len(room.users)}")
            print(f"   Encrypted: {room.encrypted}")
            
            # Get room messages using the client's room_messages method
            print(f"\n📨 Retrieving messages from room...")
            response = await client.room_messages(room_id, limit=20)
            
            if not hasattr(response, 'chunk'):
                print("❌ No messages chunk in response")
                return
            
            print(f"✅ Retrieved {len(response.chunk)} events")
            
            # Process each event with enhanced decryption
            decrypted_messages = []
            for i, event in enumerate(reversed(response.chunk)):
                event_num = i + 1
                event_type = getattr(event, 'type', 'Unknown')
                sender = getattr(event, 'sender', 'Unknown')
                event_id = getattr(event, 'event_id', 'Unknown')
                timestamp = getattr(event, 'server_timestamp', 0)
                
                # Format timestamp
                formatted_time = ''
                if timestamp:
                    import datetime
                    dt = datetime.datetime.fromtimestamp(timestamp / 1000)
                    formatted_time = dt.strftime('%Y-%m-%d %H:%M:%S')
                
                print(f"\n📋 Event {event_num}: {event_id[:20]}...")
                print(f"   Type: {event_type}")
                print(f"   Sender: {sender}")
                print(f"   Time: {formatted_time}")
                
                message_content = None
                decryption_method = "none"
                
                # Method 1: Check if it's already a decrypted text message
                if event_type == 'm.room.message' and hasattr(event, 'body'):
                    message_content = event.body
                    decryption_method = "plaintext"
                    print(f"   ✅ Plaintext message: {message_content[:100]}...")
                
                # Method 2: Check if it's an encrypted event with decrypted content
                elif event_type == 'm.room.encrypted':
                    print(f"   🔐 Encrypted event detected")
                    
                    # Check if client already decrypted it
                    if hasattr(event, 'decrypted_event') and event.decrypted_event:
                        decrypted = event.decrypted_event
                        if hasattr(decrypted, 'body'):
                            message_content = decrypted.body
                            decryption_method = "auto_decrypted"
                            print(f"   ✅ Auto-decrypted: {message_content[:100]}...")
                    
                    # Try manual decryption if auto didn't work
                    if not message_content:
                        try:
                            print(f"   🔄 Attempting manual decryption...")
                            
                            # Use the room's decrypt method if available
                            if hasattr(room, 'decrypt_event'):
                                decrypted_event = room.decrypt_event(event)
                                if decrypted_event and hasattr(decrypted_event, 'body'):
                                    message_content = decrypted_event.body
                                    decryption_method = "room_decrypt"
                                    print(f"   ✅ Room-decrypted: {message_content[:100]}...")
                            
                            # Try client decrypt method
                            elif hasattr(client, 'decrypt_event'):
                                decrypted_event = await client.decrypt_event(event)
                                if decrypted_event and hasattr(decrypted_event, 'body'):
                                    message_content = decrypted_event.body
                                    decryption_method = "client_decrypt"
                                    print(f"   ✅ Client-decrypted: {message_content[:100]}...")
                            
                        except Exception as decrypt_error:
                            print(f"   ❌ Manual decryption failed: {decrypt_error}")
                            decryption_method = "failed"
                    
                    # If still no content, mark as encrypted
                    if not message_content:
                        message_content = "[Encrypted - unable to decrypt]"
                        decryption_method = "encrypted"
                        print(f"   ❌ Unable to decrypt")
                
                # Store successful decryptions
                if message_content and decryption_method not in ["none", "failed", "encrypted"]:
                    decrypted_messages.append({
                        'sender': sender,
                        'content': message_content,
                        'timestamp': formatted_time,
                        'method': decryption_method,
                        'event_id': event_id
                    })
                    
                    # Check if this is from Sac and looks like a 4-digit number
                    if sender == sac_signal_user:
                        print(f"   🎯 MESSAGE FROM SAC: {message_content}")
                        if message_content.strip().isdigit() and len(message_content.strip()) == 4:
                            print(f"   🎉 FOUND 4-DIGIT NUMBER FROM SAC: {message_content}")
            
            # Summary
            print(f"\n📊 Decryption Summary:")
            print(f"   Total events processed: {len(response.chunk)}")
            print(f"   Successfully decrypted: {len(decrypted_messages)}")
            
            if decrypted_messages:
                print(f"\n💬 Decrypted Messages:")
                for i, msg in enumerate(decrypted_messages, 1):
                    print(f"   {i}. [{msg['timestamp']}] {msg['sender']}")
                    print(f"      Content: {msg['content']}")
                    print(f"      Method: {msg['method']}")
                    print()
            else:
                print(f"\n❌ No messages were successfully decrypted")
                print(f"   This suggests we need to:")
                print(f"   1. Import encryption keys from backup")
                print(f"   2. Set up cross-signing verification")
                print(f"   3. Use Element to export/import keys")
            
        finally:
            await client.close()
            
    except Exception as e:
        print(f"❌ Error during MegolmEvent decryption test: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_megolm_decryption()) 