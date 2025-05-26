#!/usr/bin/env python3
"""
Test script to implement Matrix key backup recovery using security key.
This should retrieve the missing Megolm session keys needed to decrypt Sac's messages.
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

async def test_key_backup_recovery():
    print("🔑 Matrix Key Backup Recovery Test")
    print("🎯 Goal: Retrieve missing Megolm session keys to decrypt Sac's messages")
    
    # Target session ID that we need to recover
    target_session_id = "5UPtPVEOWt3haPgL/uFa3BHIfNV1qFxc9RpEWVNfZCA"
    room_id = "!XXXXXXXXXXXXXXXXXX:example.com"
    sac_signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Target session ID: {target_session_id}")
    print(f"🎯 Target room: {room_id}")
    print(f"🎯 Target user: {sac_signal_user}")
    
    try:
        # Create Matrix client with enhanced encryption configuration
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
        
        # Load the store to get encryption keys
        try:
            client.load_store()
            print("✅ Encryption store loaded successfully")
        except Exception as e:
            print(f"⚠️ Store load warning: {e}")
        
        # Perform initial sync to get latest state
        print("\n🔄 Performing initial sync...")
        sync_response = await client.sync(timeout=30000, full_state=True)
        
        if not isinstance(sync_response, SyncResponse):
            print(f"❌ Sync failed: {sync_response}")
            return
        
        print(f"✅ Sync successful")
        
        # Check if we have key backup enabled on the server
        print(f"\n🔍 Checking for key backup on server...")
        
        try:
            # Try to get key backup info from server
            backup_response = await client.room_key_backup_info()
            if hasattr(backup_response, 'version'):
                print(f"✅ Key backup found on server: version {backup_response.version}")
                print(f"   Algorithm: {backup_response.algorithm}")
                print(f"   Auth data: {backup_response.auth_data}")
                
                # Try to recover keys using our security key
                await recover_keys_from_backup(client, backup_response)
            else:
                print(f"❌ No key backup found on server: {backup_response}")
        except Exception as e:
            print(f"⚠️ Key backup check failed: {e}")
        
        # Alternative: Try to request keys from other devices
        print(f"\n🔄 Attempting to request missing keys from other devices...")
        await request_missing_keys(client, room_id, target_session_id)
        
        # Test decryption again after key recovery attempts
        print(f"\n🧪 Testing decryption after key recovery...")
        await test_decryption_after_recovery(client, room_id, sac_signal_user)
        
        await client.close()
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()

async def recover_keys_from_backup(client, backup_info):
    """
    Attempt to recover keys from server backup using security key.
    """
    try:
        print("🔑 Attempting key recovery from server backup...")
        
        # Parse the security key (remove spaces and convert to bytes)
        security_key = Config.MATRIX_SECURITY_KEY.replace(" ", "")
        recovery_passphrase = Config.MATRIX_RECOVERY_PASSPHRASE
        
        print(f"   Security key: {security_key[:20]}...")
        print(f"   Recovery passphrase: {recovery_passphrase[:20]}...")
        
        # Try to decode the security key as base64
        try:
            key_bytes = base64.b64decode(security_key)
            print(f"   ✅ Security key decoded: {len(key_bytes)} bytes")
        except Exception as e:
            print(f"   ❌ Failed to decode security key: {e}")
            return
        
        # Check if client has key backup recovery methods
        if hasattr(client, 'room_key_backup_restore'):
            print("   ✅ Client supports key backup restore")
            
            # Try to restore keys using the security key
            try:
                restore_response = await client.room_key_backup_restore(
                    backup_info.version,
                    recovery_key=key_bytes
                )
                if hasattr(restore_response, 'total'):
                    print(f"   ✅ Key restore successful: {restore_response.total} keys restored")
                else:
                    print(f"   ❌ Key restore failed: {restore_response}")
            except Exception as e:
                print(f"   ❌ Key restore error: {e}")
        else:
            print("   ❌ Client does not support key backup restore")
        
    except Exception as e:
        print(f"   ❌ Key backup recovery failed: {e}")

async def request_missing_keys(client, room_id, session_id):
    """
    Request missing keys from other devices in the room.
    """
    try:
        print("📨 Requesting missing keys from other devices...")
        
        if hasattr(client, 'request_room_key'):
            print("   ✅ Client supports key requests")
            
            # Request the specific session key we need
            try:
                key_request = await client.request_room_key(
                    room_id=room_id,
                    session_id=session_id,
                    algorithm="m.megolm.v1.aes-sha2"
                )
                print(f"   ✅ Key request sent: {key_request}")
            except Exception as e:
                print(f"   ❌ Key request failed: {e}")
        else:
            print("   ❌ Client does not support key requests")
        
        # Wait a bit for key responses
        print("   ⏳ Waiting for key responses...")
        await asyncio.sleep(5)
        
    except Exception as e:
        print(f"   ❌ Key request failed: {e}")

async def test_decryption_after_recovery(client, room_id, sac_user):
    """
    Test if we can now decrypt messages after key recovery attempts.
    """
    try:
        print("🧪 Testing decryption after key recovery...")
        
        # Get room messages again
        messages_response = await client.room_messages(
            room_id=room_id,
            start="",
            limit=10
        )
        
        if hasattr(messages_response, 'chunk'):
            events = messages_response.chunk
            print(f"   📨 Retrieved {len(events)} events")
            
            decrypted_count = 0
            for event in events:
                if isinstance(event, MegolmEvent) and event.sender == sac_user:
                    try:
                        decrypted_event = client.decrypt_event(event)
                        if decrypted_event and hasattr(decrypted_event, 'body'):
                            decrypted_count += 1
                            print(f"   🎉 DECRYPTED SAC'S MESSAGE: {decrypted_event.body}")
                            
                            # Check if this contains a 4-digit number
                            if any(char.isdigit() for char in decrypted_event.body):
                                print(f"   🎯 FOUND MESSAGE WITH NUMBERS: {decrypted_event.body}")
                    except Exception as e:
                        print(f"   ❌ Still cannot decrypt: {e}")
            
            if decrypted_count > 0:
                print(f"   ✅ SUCCESS: Decrypted {decrypted_count} messages from Sac!")
            else:
                print(f"   ❌ Still cannot decrypt any messages from Sac")
        
    except Exception as e:
        print(f"   ❌ Decryption test failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_key_backup_recovery()) 