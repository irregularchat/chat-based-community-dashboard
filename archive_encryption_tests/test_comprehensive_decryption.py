#!/usr/bin/env python3
"""
Comprehensive test for Matrix message decryption using security key and recovery passphrase.
Based on Matrix community research and matrix-nio best practices.
"""
import asyncio
import sys
import os
import base64
import json
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_matrix_client
from app.utils.config import Config
from nio import AsyncClient, AsyncClientConfig, LoginResponse, SyncResponse
from nio.store import SqliteStore
from nio.crypto import OlmDevice
from nio.events import MegolmEvent

async def test_comprehensive_decryption():
    print("🧪 Comprehensive Matrix Message Decryption Test")
    print("🔑 Using security key and recovery passphrase for E2E decryption")
    
    # Use the room ID we know contains Sac's messages
    room_id = "!XXXXXXXXXXXXXXXXXX:example.com"
    sac_signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Target room: {room_id}")
    print(f"🎯 Target user: {sac_signal_user}")
    print(f"🔐 Security key: {Config.MATRIX_SECURITY_KEY[:20]}...")
    print(f"🔐 Recovery passphrase: {Config.MATRIX_RECOVERY_PASSPHRASE[:20]}...")
    
    try:
        # Create enhanced Matrix client with proper encryption configuration
        client_config = AsyncClientConfig(
            max_limit_exceeded=0,
            max_timeouts=0,
            store_sync_tokens=True,
            encryption_enabled=True,
        )
        
        # Use a persistent store path for encryption keys
        store_path = "/app/matrix_store"
        os.makedirs(store_path, exist_ok=True)
        
        client = AsyncClient(
            homeserver=Config.MATRIX_HOMESERVER_URL,
            user=Config.MATRIX_BOT_USERNAME,
            device_id=Config.MATRIX_BOT_USERNAME.replace('@', '').replace(':', '_'),
            store_path=store_path,
            config=client_config,
        )
        
        # Set authentication details
        client.access_token = Config.MATRIX_ACCESS_TOKEN
        client.user_id = Config.MATRIX_BOT_USERNAME
        
        print(f"\n✅ Matrix client created with encryption enabled")
        print(f"📁 Store path: {store_path}")
        print(f"🔐 Encryption enabled: {client_config.encryption_enabled}")
        
        # Load the store to get encryption keys
        try:
            client.load_store()
            print("✅ Encryption store loaded successfully")
        except Exception as e:
            print(f"⚠️ Store load warning: {e}")
        
        # Perform initial sync to get latest state
        print("\n🔄 Performing initial sync...")
        sync_response = await client.sync(timeout=30000, full_state=True)
        
        if isinstance(sync_response, SyncResponse):
            print(f"✅ Sync successful, next_batch: {sync_response.next_batch[:20]}...")
            
            # Check if we have the target room
            if room_id in client.rooms:
                room = client.rooms[room_id]
                print(f"✅ Found target room: {room.display_name}")
                print(f"🔐 Room encrypted: {room.encrypted}")
                print(f"👥 Room members: {len(room.users)}")
            else:
                print(f"❌ Target room {room_id} not found in joined rooms")
                return
        else:
            print(f"❌ Sync failed: {sync_response}")
            return
        
        # Get room messages using the room_messages API
        print(f"\n📨 Getting messages from room {room_id}...")
        messages_response = await client.room_messages(
            room_id=room_id,
            start="",
            limit=20
        )
        
        if hasattr(messages_response, 'chunk'):
            events = messages_response.chunk
            print(f"✅ Retrieved {len(events)} events from room")
            
            decrypted_count = 0
            encrypted_count = 0
            
            for event in events:
                print(f"\n📝 Event {event.event_id[:20]}...")
                print(f"   Type: {type(event).__name__}")
                print(f"   Sender: {getattr(event, 'sender', 'Unknown')}")
                
                if isinstance(event, MegolmEvent):
                    encrypted_count += 1
                    print(f"   🔐 Encrypted event detected")
                    
                    try:
                        # Try to decrypt the event
                        decrypted_event = client.decrypt_event(event)
                        if decrypted_event and hasattr(decrypted_event, 'body'):
                            decrypted_count += 1
                            print(f"   ✅ DECRYPTED: {decrypted_event.body}")
                            
                            # Check if this is from Sac and contains a 4-digit number
                            if (event.sender == sac_signal_user and 
                                any(char.isdigit() for char in decrypted_event.body)):
                                print(f"   🎉 FOUND SAC'S MESSAGE WITH NUMBERS: {decrypted_event.body}")
                        else:
                            print(f"   ❌ Decryption failed or no content")
                    except Exception as decrypt_error:
                        print(f"   ❌ Decryption error: {decrypt_error}")
                
                elif hasattr(event, 'body'):
                    print(f"   📄 Plain text: {event.body}")
                else:
                    print(f"   ℹ️ Non-message event")
            
            print(f"\n📊 Decryption Summary:")
            print(f"   Total events: {len(events)}")
            print(f"   Encrypted events: {encrypted_count}")
            print(f"   Successfully decrypted: {decrypted_count}")
            
            if encrypted_count > 0 and decrypted_count == 0:
                print(f"\n🔍 Troubleshooting encrypted messages...")
                
                # Check if we have the necessary encryption keys
                if hasattr(client, 'olm'):
                    print(f"   ✅ OLM account available")
                else:
                    print(f"   ❌ No OLM account found")
                
                # Check device store
                if room_id in client.rooms:
                    room = client.rooms[room_id]
                    for user_id in room.users:
                        if user_id in client.device_store:
                            devices = client.device_store[user_id]
                            print(f"   👤 {user_id}: {len(devices)} devices")
                            for device_id, device in devices.items():
                                print(f"      📱 {device_id}: {device.trust_state}")
                        else:
                            print(f"   👤 {user_id}: No devices in store")
                
                # Try to implement security key recovery
                print(f"\n🔑 Attempting security key recovery...")
                await implement_security_key_recovery(client)
        
        else:
            print(f"❌ Failed to get room messages: {messages_response}")
        
        await client.close()
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()

async def implement_security_key_recovery(client):
    """
    Implement security key recovery based on Matrix community research.
    """
    try:
        print("🔑 Implementing security key recovery...")
        
        # Parse the security key (remove spaces and convert to bytes)
        security_key = Config.MATRIX_SECURITY_KEY.replace(" ", "")
        recovery_passphrase = Config.MATRIX_RECOVERY_PASSPHRASE
        
        print(f"   Security key length: {len(security_key)}")
        print(f"   Recovery passphrase length: {len(recovery_passphrase)}")
        
        # Try to decode the security key as base64
        try:
            key_bytes = base64.b64decode(security_key)
            print(f"   ✅ Security key decoded as base64: {len(key_bytes)} bytes")
        except Exception as e:
            print(f"   ❌ Failed to decode security key as base64: {e}")
            return
        
        # Check if client has backup recovery methods
        if hasattr(client, 'import_keys'):
            print("   ✅ Client supports key import")
        else:
            print("   ❌ Client does not support key import")
        
        # Try to use the recovery passphrase for key derivation
        # This is where we would implement the actual key recovery logic
        # based on the Matrix specification for key backup recovery
        
        print("   🔄 Key recovery implementation would go here...")
        print("   📚 This requires implementing Matrix key backup specification")
        
    except Exception as e:
        print(f"   ❌ Security key recovery failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_comprehensive_decryption()) 