#!/usr/bin/env node

/**
 * Signal Verification Debug Test Script
 * 
 * This script tests each step of the Signal verification process to identify issues.
 * Run with: node test-signal-debug.js
 */

import { createClient } from 'matrix-js-sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const CONFIG = {
  homeserver: process.env.MATRIX_HOMESERVER,
  accessToken: process.env.MATRIX_ACCESS_TOKEN,
  userId: process.env.MATRIX_BOT_USERNAME,
  signalBridgeRoomId: process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID,
  signalBotUsername: process.env.MATRIX_SIGNAL_BOT_USERNAME,
  matrixDomain: process.env.MATRIX_DOMAIN || 'irregularchat.com',
  testPhoneNumber: process.env.TEST_PHONE_NUMBER || '+12247253276' // The number from your example
};

console.log('🔧 Signal Verification Debug Script');
console.log('=====================================');
console.log('Configuration:');
Object.entries(CONFIG).forEach(([key, value]) => {
  console.log(`  ${key}: ${value ? (key.includes('token') ? '***' : value) : 'NOT SET'}`);
});
console.log('');

class SignalDebugger {
  constructor() {
    this.client = null;
    this.testResults = [];
  }

  log(step, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, step, message, data };
    console.log(`[${timestamp}] ${step}: ${message}`);
    if (data) {
      console.log(`  Data:`, data);
    }
    this.testResults.push(logEntry);
  }

  async initialize() {
    this.log('INIT', '🚀 Initializing Matrix client...');
    
    if (!CONFIG.homeserver || !CONFIG.accessToken || !CONFIG.userId) {
      throw new Error('Missing required Matrix configuration. Check MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN, MATRIX_BOT_USERNAME');
    }

    try {
      this.client = createClient({
        baseUrl: CONFIG.homeserver,
        accessToken: CONFIG.accessToken,
        userId: CONFIG.userId,
      });

      this.log('INIT', '✅ Matrix client created successfully');
      
      // Test basic client functionality
      const profile = await this.client.getProfileInfo(CONFIG.userId);
      this.log('INIT', '✅ Client authentication verified', { profile });
      
      return true;
    } catch (error) {
      this.log('INIT', '❌ Failed to initialize Matrix client', { error: error.message });
      throw error;
    }
  }

  async testStep1_CheckSignalBridgeRoom() {
    this.log('STEP1', '🔍 Testing Signal bridge room access...');
    
    if (!CONFIG.signalBridgeRoomId) {
      this.log('STEP1', '❌ MATRIX_SIGNAL_BRIDGE_ROOM_ID not configured');
      return false;
    }

    try {
      // Check if we can access the Signal bridge room
      const room = this.client.getRoom(CONFIG.signalBridgeRoomId);
      if (!room) {
        this.log('STEP1', '❌ Signal bridge room not found in joined rooms', { roomId: CONFIG.signalBridgeRoomId });
        
        // List all joined rooms for debugging
        const joinedRooms = await this.client.getJoinedRooms();
        this.log('STEP1', '📋 Available joined rooms:', { 
          count: joinedRooms.joined_rooms.length,
          rooms: joinedRooms.joined_rooms.slice(0, 5) // Show first 5 for debugging
        });
        return false;
      }

      this.log('STEP1', '✅ Signal bridge room found');
      
      // Get room members to verify Signal bot is present
      const roomState = await this.client.roomState(CONFIG.signalBridgeRoomId);
      const members = roomState
        .filter(event => event.type === 'm.room.member' && event.content?.membership === 'join')
        .map(event => event.state_key);
      
      this.log('STEP1', '👥 Signal bridge room members:', { 
        count: members.length,
        members: members,
        hasSignalBot: members.includes(CONFIG.signalBotUsername)
      });

      if (!members.includes(CONFIG.signalBotUsername)) {
        this.log('STEP1', '⚠️ Signal bot not found in bridge room', { 
          expected: CONFIG.signalBotUsername,
          found: members
        });
      }

      return true;
    } catch (error) {
      this.log('STEP1', '❌ Error accessing Signal bridge room', { error: error.message });
      return false;
    }
  }

  async testStep2_ResolvePhoneNumber() {
    this.log('STEP2', `🔍 Testing phone number resolution: ${CONFIG.testPhoneNumber}`);
    
    try {
      // Send resolve-identifier command
      const resolveCommand = `resolve-identifier ${CONFIG.testPhoneNumber}`;
      this.log('STEP2', `📤 Sending resolve command: ${resolveCommand}`);
      
      const commandResponse = await this.client.sendEvent(CONFIG.signalBridgeRoomId, 'm.room.message', {
        msgtype: 'm.text',
        body: resolveCommand,
      });

      this.log('STEP2', '✅ Resolve command sent', { eventId: commandResponse.event_id });

      // Wait for bot response
      this.log('STEP2', '⏱️ Waiting for Signal bot response...');
      await new Promise(resolve => setTimeout(resolve, 4000)); // Wait 4 seconds

      // Get recent messages to find bot response
      const room = this.client.getRoom(CONFIG.signalBridgeRoomId);
      const timeline = room.getLiveTimeline();
      const events = timeline.getEvents();
      
      // Look for bot response in last 10 events
      const recentEvents = events.slice(-10);
      this.log('STEP2', `🔍 Checking last ${recentEvents.length} events for bot response...`);
      
      let botResponse = null;
      let signalUuid = null;
      
      for (const event of recentEvents) {
        if (event.getType() === 'm.room.message' && 
            event.getSender() === CONFIG.signalBotUsername) {
          
          const content = event.getContent();
          this.log('STEP2', '🤖 Found bot message', { 
            sender: event.getSender(),
            body: content.body,
            timestamp: event.getTs()
          });
          
          // Check if it's a "Found" response
          if (content.body?.includes('Found')) {
            botResponse = content.body;
            const uuidMatch = content.body.match(/Found `([a-f0-9-]+)`/);
            if (uuidMatch) {
              signalUuid = uuidMatch[1];
              this.log('STEP2', '✅ Successfully resolved phone to UUID', { 
                phone: CONFIG.testPhoneNumber,
                uuid: signalUuid,
                fullResponse: botResponse
              });
              return signalUuid;
            }
          }
          
          // Check for error responses
          if (content.body?.includes('Failed to resolve') || 
              content.body?.includes('phone number must start with')) {
            this.log('STEP2', '❌ Signal bot returned error', { response: content.body });
            return null;
          }
        }
      }

      if (!botResponse) {
        this.log('STEP2', '❌ No response from Signal bot found', {
          botUsername: CONFIG.signalBotUsername,
          recentMessages: recentEvents.map(e => ({
            sender: e.getSender(),
            type: e.getType(),
            body: e.getContent()?.body?.substring(0, 100)
          }))
        });
      }

      return signalUuid;
    } catch (error) {
      this.log('STEP2', '❌ Error resolving phone number', { error: error.message });
      return null;
    }
  }

  async testStep3_StartChat(signalUuid) {
    if (!signalUuid) {
      this.log('STEP3', '⏭️ Skipping start-chat test (no UUID from previous step)');
      return null;
    }

    this.log('STEP3', `🚀 Testing start-chat command with UUID: ${signalUuid}`);
    
    try {
      // Send start-chat command
      const startChatCommand = `start-chat ${signalUuid}`;
      this.log('STEP3', `📤 Sending start-chat command: ${startChatCommand}`);
      
      const commandResponse = await this.client.sendEvent(CONFIG.signalBridgeRoomId, 'm.room.message', {
        msgtype: 'm.text',
        body: startChatCommand,
      });

      this.log('STEP3', '✅ Start-chat command sent', { eventId: commandResponse.event_id });

      // Wait for room creation
      this.log('STEP3', '⏱️ Waiting for Signal bridge to create chat room...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      return true;
    } catch (error) {
      this.log('STEP3', '❌ Error sending start-chat command', { error: error.message });
      return false;
    }
  }

  async testStep4_FindSignalChatRoom(signalUuid) {
    if (!signalUuid) {
      this.log('STEP4', '⏭️ Skipping room finding test (no UUID)');
      return null;
    }

    const signalUserId = `@signal_${signalUuid}:${CONFIG.matrixDomain}`;
    this.log('STEP4', `🔍 Searching for Signal chat room with user: ${signalUserId}`);
    
    try {
      const joinedRooms = await this.client.getJoinedRooms();
      this.log('STEP4', `📋 Searching through ${joinedRooms.joined_rooms.length} joined rooms...`);
      
      for (const roomId of joinedRooms.joined_rooms) {
        try {
          const roomState = await this.client.roomState(roomId);
          const members = [];
          let roomName = '';
          let topic = '';

          for (const event of roomState) {
            if (event.type === 'm.room.member' && 
                event.state_key && 
                event.content?.membership === 'join') {
              members.push(event.state_key);
            } else if (event.type === 'm.room.name') {
              roomName = event.content?.name || '';
            } else if (event.type === 'm.room.topic') {
              topic = event.content?.topic || '';
            }
          }

          // Check if this room contains the Signal user
          if (members.includes(signalUserId)) {
            this.log('STEP4', '🎯 Found Signal chat room!', {
              roomId,
              roomName,
              topic,
              memberCount: members.length,
              members: members,
              hasBot: members.includes(CONFIG.userId)
            });
            return roomId;
          }
        } catch (roomError) {
          // Silently continue - some rooms might not be accessible
        }
      }

      this.log('STEP4', '❌ No Signal chat room found', { 
        searchedFor: signalUserId,
        totalRoomsSearched: joinedRooms.joined_rooms.length
      });
      return null;
    } catch (error) {
      this.log('STEP4', '❌ Error finding Signal chat room', { error: error.message });
      return null;
    }
  }

  async testStep5_SendMessage(roomId, signalUuid) {
    if (!roomId) {
      this.log('STEP5', '⏭️ Skipping message sending test (no room found)');
      return false;
    }

    this.log('STEP5', `📤 Testing message sending to room: ${roomId}`);
    
    try {
      const testMessage = `🧪 Test Message - Verification Code: 123456\n\nThis is a test of the Signal verification system.\n\nTime: ${new Date().toISOString()}`;
      
      // Send preparatory message
      this.log('STEP5', '🔐 Sending preparatory message...');
      const prepResponse = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: '🔐 Securing message...',
      });
      this.log('STEP5', '✅ Preparatory message sent', { eventId: prepResponse.event_id });
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Send actual test message
      this.log('STEP5', '📤 Sending test verification message...');
      const messageResponse = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: testMessage,
      });

      this.log('STEP5', '✅ Test message sent successfully!', { 
        eventId: messageResponse.event_id,
        roomId,
        message: testMessage.substring(0, 100) + '...'
      });
      
      return true;
    } catch (error) {
      this.log('STEP5', '❌ Error sending test message', { error: error.message });
      return false;
    }
  }

  async runFullTest() {
    console.log('🧪 Starting comprehensive Signal verification test...\n');
    
    try {
      // Initialize
      await this.initialize();

      // Test each step
      const step1Success = await this.testStep1_CheckSignalBridgeRoom();
      const signalUuid = await this.testStep2_ResolvePhoneNumber();
      const step3Success = await this.testStep3_StartChat(signalUuid);
      const chatRoomId = await this.testStep4_FindSignalChatRoom(signalUuid);
      const step5Success = await this.testStep5_SendMessage(chatRoomId, signalUuid);

      // Summary
      console.log('\n📊 Test Results Summary:');
      console.log('========================');
      console.log(`Step 1 - Signal Bridge Room Access: ${step1Success ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`Step 2 - Phone Number Resolution: ${signalUuid ? '✅ PASS' : '❌ FAIL'} ${signalUuid ? `(UUID: ${signalUuid})` : ''}`);
      console.log(`Step 3 - Start Chat Command: ${step3Success ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`Step 4 - Find Signal Chat Room: ${chatRoomId ? '✅ PASS' : '❌ FAIL'} ${chatRoomId ? `(Room: ${chatRoomId})` : ''}`);
      console.log(`Step 5 - Send Test Message: ${step5Success ? '✅ PASS' : '❌ FAIL'}`);
      
      const overallSuccess = step1Success && signalUuid && step3Success && chatRoomId && step5Success;
      console.log(`\n🎯 Overall Result: ${overallSuccess ? '✅ SUCCESS' : '❌ FAILURE'}`);
      
      if (!overallSuccess) {
        console.log('\n🔧 Debugging Information:');
        console.log('==========================');
        this.testResults.forEach(result => {
          if (result.step.startsWith('STEP') && result.message.includes('❌')) {
            console.log(`${result.step}: ${result.message}`);
            if (result.data) {
              console.log(`  Data:`, JSON.stringify(result.data, null, 2));
            }
          }
        });
      }

      return overallSuccess;
    } catch (error) {
      console.error('💥 Test failed with exception:', error);
      return false;
    }
  }
}

// Run the test
async function main() {
  const signalDebugger = new SignalDebugger();
  const success = await signalDebugger.runFullTest();
  process.exit(success ? 0 : 1);
}

main().catch(console.error); 