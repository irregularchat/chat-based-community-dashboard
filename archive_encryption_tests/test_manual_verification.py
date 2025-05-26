#!/usr/bin/env python3
"""
Test script to verify manual session verification process.
This simulates what happens when you click "Verify session" in the Matrix client.
"""
import asyncio
import sys
import os
import json
sys.path.insert(0, '/app')

from app.utils.matrix_actions import get_matrix_client
from app.utils.config import Config
from nio import AsyncClient, AsyncClientConfig, LoginResponse, SyncResponse
from nio.store import SqliteStore
from nio.crypto import OlmDevice
from nio.events import KeyVerificationStart, KeyVerificationAccept, KeyVerificationKey, KeyVerificationMac

async def test_manual_verification():
    print("🔐 Manual Session Verification Test")
    print("🎯 Testing what happens when you manually verify a Matrix session")
    print("This simulates clicking 'Verify session' in the Matrix client")
    
    # Use the room ID we know contains Sac's messages
    room_id = "!XXXXXXXXXXXXXXXXXX:example.com"
    sac_signal_user = "@signal_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX:example.com"
    
    print(f"\n🎯 Target room: {room_id}")
    print(f"🎯 Target user: {sac_signal_user}")
    print(f"🔑 Security key: {Config.MATRIX_SECURITY_KEY[:20]}..." if Config.MATRIX_SECURITY_KEY else "❌ Not configured")
    print(f"🔑 Recovery passphrase: {'✅ Configured' if Config.MATRIX_RECOVERY_PASSPHRASE else '❌ Not configured'}")
    
    try:
        # Get Matrix client with enhanced encryption support
        client = await get_matrix_client()
        if not client:
            print("❌ Failed to create Matrix client")
            return
        
        print(f"\n✅ Matrix client created successfully")
        print(f"   User ID: {client.user_id}")
        print(f"   Device ID: {client.device_id}")
        print(f"   Encryption enabled: {client.olm is not None}")
        
        # Perform initial sync to get current state
        print(f"\n🔄 Performing initial sync...")
        sync_response = await client.sync(timeout=10000)
        print(f"   Sync status: {type(sync_response).__name__}")
        
        if hasattr(sync_response, 'rooms'):
            print(f"   Rooms in sync: {len(sync_response.rooms.join) if sync_response.rooms.join else 0}")
        
        # Check device verification status
        print(f"\n🔍 Checking device verification status...")
        
        if client.olm:
            print(f"   OLM device available: ✅")
            print(f"   Device ID: {client.device_id}")
            
            # Get device keys
            try:
                device_keys = client.olm.account.identity_keys
                print(f"   Identity keys available: ✅")
                print(f"   Curve25519 key: {device_keys.get('curve25519', 'Not found')[:20]}...")
                print(f"   Ed25519 key: {device_keys.get('ed25519', 'Not found')[:20]}...")
            except Exception as e:
                print(f"   ❌ Error getting device keys: {e}")
            
            # Check if we have any verified devices
            try:
                # Get our own user's devices
                user_devices = client.device_store.active_user_devices(client.user_id)
                print(f"   Active devices for {client.user_id}: {len(user_devices) if user_devices else 0}")
                
                if user_devices:
                    for device_id, device in user_devices.items():
                        trust_state = client.olm.is_device_verified(device)
                        print(f"     Device {device_id}: {'✅ Verified' if trust_state else '❌ Unverified'}")
                
            except Exception as e:
                print(f"   ❌ Error checking device verification: {e}")
        else:
            print(f"   ❌ OLM device not available")
        
        # Check cross-signing status
        print(f"\n🔐 Checking cross-signing status...")
        try:
            if hasattr(client, 'olm') and client.olm:
                # Check if we have cross-signing keys
                cross_signing_keys = getattr(client.olm, 'cross_signing_keys', None)
                if cross_signing_keys:
                    print(f"   Cross-signing keys available: ✅")
                else:
                    print(f"   Cross-signing keys: ❌ Not available")
                
                # Check if cross-signing is set up
                if hasattr(client.olm, 'cross_signing'):
                    print(f"   Cross-signing setup: ✅")
                else:
                    print(f"   Cross-signing setup: ❌ Not configured")
            else:
                print(f"   ❌ Cannot check cross-signing - OLM not available")
        except Exception as e:
            print(f"   ❌ Error checking cross-signing: {e}")
        
        # Attempt to start device verification process
        print(f"\n🔄 Attempting to start device verification...")
        try:
            # Check if there are any unverified devices to verify
            if client.olm:
                user_devices = client.device_store.active_user_devices(client.user_id)
                unverified_devices = []
                
                if user_devices:
                    for device_id, device in user_devices.items():
                        if device_id != client.device_id:  # Don't verify our own device
                            trust_state = client.olm.is_device_verified(device)
                            if not trust_state:
                                unverified_devices.append((device_id, device))
                
                print(f"   Found {len(unverified_devices)} unverified devices")
                
                if unverified_devices:
                    for device_id, device in unverified_devices[:1]:  # Try first unverified device
                        print(f"   Attempting to verify device: {device_id}")
                        
                        # This is where manual verification would typically start
                        # In a real client, this would show verification codes/emojis
                        print(f"   📱 Manual verification would show verification codes here")
                        print(f"   🔢 User would compare codes and confirm match")
                        print(f"   ✅ Upon confirmation, device would be marked as verified")
                else:
                    print(f"   ℹ️ No unverified devices found to verify")
            else:
                print(f"   ❌ Cannot start verification - OLM not available")
                
        except Exception as e:
            print(f"   ❌ Error starting verification: {e}")
        
        # Check key backup status
        print(f"\n💾 Checking key backup status...")
        try:
            # Check if key backup is configured
            if hasattr(client, 'key_backup_version'):
                backup_version = getattr(client, 'key_backup_version', None)
                if backup_version:
                    print(f"   Key backup version: {backup_version}")
                else:
                    print(f"   Key backup: ❌ Not configured")
            else:
                print(f"   Key backup: ❌ Not available in client")
            
            # Try to check backup with security key
            if Config.MATRIX_SECURITY_KEY:
                print(f"   Security key available: ✅")
                print(f"   🔑 Manual key backup recovery could be attempted")
                print(f"   📝 This would require implementing key backup recovery flow")
            else:
                print(f"   Security key: ❌ Not configured")
                
        except Exception as e:
            print(f"   ❌ Error checking key backup: {e}")
        
        # Test message decryption after potential verification
        print(f"\n🔍 Testing message decryption status...")
        try:
            # Get recent messages from the room
            response = await client.room_messages(room_id, start="", limit=5)
            
            if hasattr(response, 'chunk') and response.chunk:
                print(f"   Retrieved {len(response.chunk)} recent messages")
                
                encrypted_count = 0
                decrypted_count = 0
                
                for event in response.chunk:
                    if hasattr(event, 'type'):
                        if event.type == "m.room.encrypted":
                            encrypted_count += 1
                            print(f"     📧 Encrypted message found")
                        elif hasattr(event, 'body'):
                            decrypted_count += 1
                            print(f"     📖 Readable message: {event.body[:30]}...")
                
                print(f"   Summary: {encrypted_count} encrypted, {decrypted_count} readable")
                
                if encrypted_count > 0:
                    print(f"   💡 Manual verification might help decrypt these messages")
                    print(f"   🔧 Steps to try:")
                    print(f"      1. Open Matrix client (Element, etc.)")
                    print(f"      2. Look for 'Unverified session' warnings")
                    print(f"      3. Click 'Verify session'")
                    print(f"      4. Follow verification prompts")
                    print(f"      5. Check if messages become readable")
            else:
                print(f"   ❌ No messages retrieved from room")
                
        except Exception as e:
            print(f"   ❌ Error testing message decryption: {e}")
        
        # Provide manual verification guidance
        print(f"\n📋 Manual Verification Guidance:")
        print(f"   1. 🌐 Open your Matrix client (Element web/desktop/mobile)")
        print(f"   2. 🔍 Look for security warnings or 'Unverified session' notices")
        print(f"   3. 🔐 Click 'Verify session' or 'Verify this device'")
        print(f"   4. 📱 Follow the verification flow (compare codes/emojis)")
        print(f"   5. ✅ Confirm the verification when codes match")
        print(f"   6. 🔄 Restart the bot application to pick up new keys")
        print(f"   7. 🧪 Re-run message history tests to check decryption")
        
        print(f"\n🎯 Expected Results After Manual Verification:")
        print(f"   ✅ Device should be marked as verified")
        print(f"   🔑 Encryption keys should be shared")
        print(f"   📖 New messages should be readable immediately")
        print(f"   📚 Some historical messages might become readable")
        print(f"   🔄 Bot should have access to room encryption keys")
        
        await client.close()
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_manual_verification()) 