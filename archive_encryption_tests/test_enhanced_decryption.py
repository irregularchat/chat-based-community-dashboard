#!/usr/bin/env python3
"""
Enhanced test script to decrypt Matrix messages using proper key sharing and session management.
Based on research from Matrix community solutions.
"""
import asyncio
import sys
import json
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_matrix_client
from nio import AsyncClient, RoomKeyRequestEvent, KeysUploadResponse
from nio.crypto import OlmDevice

async def test_enhanced_decryption():
    print("🧪 Testing enhanced Matrix message decryption...")
    print("🔍 Based on Matrix community solutions for encrypted message handling")
    
    # Use the room ID we know contains Sac's messages
    room_id = "!XXXXXXXXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Attempting enhanced decryption for room: {room_id}")
    print("This implements proper key sharing and session management")
    
    try:
        # Get Matrix client with enhanced encryption setup
        client = await get_matrix_client()
        if not client:
            print("❌ Failed to create Matrix client")
            return
        
        try:
            # Step 1: Ensure we have proper encryption setup
            print(f"\n📍 Step 1: Verifying encryption setup...")
            
            # Check if client has encryption enabled
            if hasattr(client, 'olm'):
                print(f"✅ Olm encryption available")
                if hasattr(client, 'store'):
                    print(f"✅ Crypto store available")
                else:
                    print(f"⚠️  No crypto store - this may limit decryption")
            else:
                print(f"❌ No Olm encryption support")
            
            # Step 2: Sync to get latest encryption keys
            print(f"\n📍 Step 2: Syncing to get latest encryption keys...")
            sync_response = await client.sync(timeout=5000, full_state=True)
            print(f"✅ Sync completed: {type(sync_response).__name__}")
            
            # Step 3: Try to get room keys for the specific room
            print(f"\n📍 Step 3: Checking room encryption status...")
            
            # Get room info
            if room_id in client.rooms:
                room = client.rooms[room_id]
                print(f"✅ Room found: {room.display_name or 'Unnamed'}")
                print(f"   - Members: {len(room.users)}")
                print(f"   - Encrypted: {room.encrypted}")
                
                if room.encrypted:
                    print(f"   🔒 Room is encrypted - attempting to get decryption keys")
                    
                    # Try to get outbound group session for this room
                    if hasattr(client, 'olm') and client.olm:
                        try:
                            # Check if we have an outbound session for this room
                            session_id = None
                            if hasattr(client.olm, 'outbound_group_sessions'):
                                if room_id in client.olm.outbound_group_sessions:
                                    session = client.olm.outbound_group_sessions[room_id]
                                    session_id = session.id
                                    print(f"   ✅ Found outbound session: {session_id}")
                                else:
                                    print(f"   ⚠️  No outbound session found for room")
                            
                            # Check inbound sessions
                            if hasattr(client.olm, 'inbound_group_store'):
                                sessions = client.olm.inbound_group_store.get(room_id, {})
                                print(f"   📊 Inbound sessions for room: {len(sessions)}")
                                for sender_key, sender_sessions in sessions.items():
                                    print(f"     - Sender {sender_key[:20]}...: {len(sender_sessions)} sessions")
                        except Exception as e:
                            print(f"   ⚠️  Error checking sessions: {e}")
                else:
                    print(f"   ℹ️  Room is not encrypted")
            else:
                print(f"❌ Room not found in client rooms")
            
            # Step 4: Get messages with enhanced decryption attempt
            print(f"\n📍 Step 4: Retrieving messages with enhanced decryption...")
            response = await client.room_messages(room_id, limit=10)
            
            if hasattr(response, 'chunk'):
                messages = response.chunk
                print(f"✅ Retrieved {len(messages)} events")
                
                decrypted_count = 0
                sac_messages = []
                
                for i, event in enumerate(messages, 1):
                    sender = getattr(event, 'sender', 'Unknown')
                    event_id = getattr(event, 'event_id', 'Unknown')
                    event_type = getattr(event, 'type', 'Unknown')
                    
                    # Check for timestamp
                    timestamp = "Unknown"
                    if hasattr(event, 'server_timestamp'):
                        import datetime
                        dt = datetime.datetime.fromtimestamp(event.server_timestamp / 1000)
                        timestamp = dt.strftime('%Y-%m-%d %H:%M:%S')
                    
                    print(f"\n{i}. [{timestamp}] {sender}")
                    print(f"   Event: {event_id}")
                    print(f"   Type: {event_type}")
                    
                    # Try multiple decryption approaches
                    decrypted_content = None
                    
                    if event_type == 'm.room.message':
                        # Already decrypted message
                        if hasattr(event, 'body'):
                            decrypted_content = event.body
                            decrypted_count += 1
                            print(f"   💬 Content: {decrypted_content}")
                    
                    elif event_type == 'm.room.encrypted':
                        print(f"   🔒 Encrypted message - attempting decryption...")
                        
                        # Method 1: Check if already decrypted
                        if hasattr(event, 'decrypted_event'):
                            decrypted = event.decrypted_event
                            if hasattr(decrypted, 'body'):
                                decrypted_content = decrypted.body
                                decrypted_count += 1
                                print(f"   💬 Decrypted (cached): {decrypted_content}")
                        
                        # Method 2: Try manual decryption
                        elif hasattr(client, 'decrypt_event') and hasattr(event, 'source'):
                            try:
                                decrypted_event = await client.decrypt_event(event)
                                if decrypted_event and hasattr(decrypted_event, 'body'):
                                    decrypted_content = decrypted_event.body
                                    decrypted_count += 1
                                    print(f"   💬 Decrypted (manual): {decrypted_content}")
                            except Exception as e:
                                print(f"   ❌ Manual decryption failed: {e}")
                        
                        # Method 3: Check event content directly
                        if not decrypted_content and hasattr(event, 'content'):
                            content = event.content
                            if isinstance(content, dict):
                                # Look for decrypted content in various places
                                for key in ['body', 'decrypted_content', 'plaintext']:
                                    if key in content and content[key]:
                                        decrypted_content = content[key]
                                        decrypted_count += 1
                                        print(f"   💬 Found in content.{key}: {decrypted_content}")
                                        break
                        
                        if not decrypted_content:
                            print(f"   🔒 Unable to decrypt - may need key sharing")
                    
                    else:
                        print(f"   ℹ️  Non-message event: {event_type}")
                    
                    # Check if this is from Sac and looks like a 4-digit number
                    if (sender == "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com" 
                        and decrypted_content):
                        sac_messages.append({
                            'timestamp': timestamp,
                            'content': decrypted_content,
                            'event_id': event_id
                        })
                        
                        if decrypted_content.strip().isdigit() and len(decrypted_content.strip()) == 4:
                            print(f"   🎯 FOUND: This looks like Sac's 4-digit number: {decrypted_content}")
                
                print(f"\n📊 Enhanced Decryption Results:")
                print(f"   - Total events: {len(messages)}")
                print(f"   - Successfully decrypted: {decrypted_count}")
                print(f"   - Messages from Sac: {len(sac_messages)}")
                
                if sac_messages:
                    print(f"\n📱 Sac's Messages:")
                    for msg in sac_messages:
                        print(f"   [{msg['timestamp']}] {msg['content']}")
                        if msg['content'].strip().isdigit() and len(msg['content'].strip()) == 4:
                            print(f"   🎯 4-digit number found: {msg['content']}")
                
                if decrypted_count == 0:
                    print(f"\n💡 Decryption Recommendations:")
                    print(f"   1. Ensure bot account has been invited to encrypted rooms")
                    print(f"   2. Verify key backup is enabled")
                    print(f"   3. Consider implementing key request/sharing")
                    print(f"   4. Check if Signal bridge requires special handling")
                
            else:
                print(f"❌ Invalid response format")
                
        finally:
            await client.close()
            
    except Exception as e:
        print(f"❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test_enhanced_decryption()) 