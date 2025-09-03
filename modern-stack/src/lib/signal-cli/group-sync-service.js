/**
 * Signal Group Sync Service
 * Syncs Signal group data to the database to avoid real-time fetching timeouts
 */

const { PrismaClient } = require('../../generated/prisma');
const net = require('net');

class SignalGroupSyncService {
  constructor(config = {}) {
    this.prisma = new PrismaClient();
    this.phoneNumber = config.phoneNumber || process.env.SIGNAL_PHONE_NUMBER || process.env.SIGNAL_BOT_PHONE_NUMBER;
    this.socketPath = config.socketPath || '/tmp/signal-cli-socket';
    this.syncInterval = config.syncInterval || 15 * 60 * 1000; // 15 minutes default
    this.syncTimer = null;
  }

  /**
   * Send JSON-RPC request to Signal CLI daemon
   */
  async sendJsonRpcRequest(method, params = {}, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let responseData = '';
      let resolved = false;
      
      const request = {
        jsonrpc: '2.0',
        method: method,
        params: {
          account: this.phoneNumber,
          ...params
        },
        id: `sync-${Date.now()}`
      };

      const timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          reject(new Error('Request timeout'));
        }
      }, timeout);

      socket.connect(this.socketPath, () => {
        socket.write(JSON.stringify(request) + '\n');
      });

      socket.on('data', (data) => {
        responseData += data.toString();
        
        try {
          const lines = responseData.split('\n').filter(line => line.trim());
          for (const line of lines) {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeoutHandle);
                socket.destroy();
                
                if (response.error) {
                  reject(new Error(response.error.message || 'Unknown error'));
                } else {
                  resolve(response.result);
                }
              }
              return;
            }
          }
        } catch (error) {
          // Continue accumulating data
        }
      });

      socket.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutHandle);
          reject(error);
        }
      });
    });
  }

  /**
   * Sync all groups from Signal to database
   */
  async syncGroups() {
    console.log('🔄 Starting group sync...');
    
    try {
      // Fetch groups without members first (faster)
      const groups = await this.sendJsonRpcRequest('listGroups', {
        'get-members': false
      }, 30000);
      
      if (!groups || !Array.isArray(groups)) {
        throw new Error('Invalid groups response');
      }
      
      console.log(`📊 Found ${groups.length} groups to sync`);
      
      // Process each group
      for (const group of groups) {
        try {
          await this.syncSingleGroup(group);
        } catch (error) {
          console.error(`❌ Failed to sync group ${group.name}:`, error.message);
        }
      }
      
      console.log('✅ Group sync completed');
      return { success: true, groupCount: groups.length };
      
    } catch (error) {
      console.error('❌ Group sync failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync a single group and its members
   */
  async syncSingleGroup(groupData) {
    const groupId = groupData.id;
    
    // Upsert group information
    await this.prisma.signalGroup.upsert({
      where: { groupId },
      update: {
        name: groupData.name || 'Unnamed Group',
        description: groupData.description,
        memberCount: groupData.members?.length || 0,
        revision: groupData.revision || 0,
        isBlocked: groupData.isBlocked || false,
        isMember: groupData.isMember !== false,
        isAdmin: groupData.isAdmin || false,
        lastSync: new Date()
      },
      create: {
        id: groupId, // Use groupId as the primary key
        groupId: groupId,
        name: groupData.name || 'Unnamed Group',
        description: groupData.description,
        memberCount: groupData.members?.length || 0,
        revision: groupData.revision || 0,
        isBlocked: groupData.isBlocked || false,
        isMember: groupData.isMember !== false,
        isAdmin: groupData.isAdmin || false,
        lastSync: new Date()
      }
    });
    
    // If we have member data, sync it
    if (groupData.members && Array.isArray(groupData.members)) {
      await this.syncGroupMembers(groupId, groupData.members, groupData.admins);
    } else {
      // Try to fetch members separately for this group
      await this.fetchAndSyncGroupMembers(groupId);
    }
  }

  /**
   * Fetch and sync members for a specific group
   */
  async fetchAndSyncGroupMembers(groupId) {
    try {
      console.log(`  📥 Fetching members for group ${groupId}...`);
      
      // Fetch group with members
      const groups = await this.sendJsonRpcRequest('listGroups', {
        'group-id': groupId,
        'get-members': true
      }, 45000); // 45 second timeout for member fetching
      
      if (groups && groups[0] && groups[0].members) {
        await this.syncGroupMembers(groupId, groups[0].members, groups[0].admins);
        
        // Update member count
        await this.prisma.signalGroup.update({
          where: { groupId },
          data: { 
            memberCount: groups[0].members.length,
            lastSync: new Date()
          }
        });
      }
    } catch (error) {
      console.log(`  ⚠️ Could not fetch members for group (timeout expected for large groups)`);
      // This is expected for large groups, not a critical error
    }
  }

  /**
   * Sync group members to database
   */
  async syncGroupMembers(groupId, members, adminUuids = []) {
    // Delete existing members for this group
    await this.prisma.signalGroupMember.deleteMany({
      where: { groupId }
    });
    
    // Insert new members
    const memberData = members.map(member => ({
      groupId,
      uuid: member.uuid || member,
      number: member.number || null,
      name: member.name || null,
      profileName: member.profileName || null,
      username: member.username || null,
      isAdmin: adminUuids.includes(member.uuid || member),
      isBanned: member.isBanned || false,
      joinedAt: member.joinedAt ? new Date(member.joinedAt) : null,
      addedBy: member.addedBy || null
    }));
    
    if (memberData.length > 0) {
      await this.prisma.signalGroupMember.createMany({
        data: memberData,
        skipDuplicates: true
      });
      
      console.log(`  ✅ Synced ${memberData.length} members`);
    }
  }

  /**
   * Get cached group data from database
   */
  async getCachedGroup(groupId) {
    return await this.prisma.signalGroup.findUnique({
      where: { groupId },
      include: { members: true }
    });
  }

  /**
   * Get all cached groups from database
   */
  async getCachedGroups() {
    return await this.prisma.signalGroup.findMany({
      include: { members: false },
      orderBy: { memberCount: 'desc' }
    });
  }

  /**
   * Get cached group members
   */
  async getCachedGroupMembers(groupId) {
    return await this.prisma.signalGroupMember.findMany({
      where: { groupId }
    });
  }

  /**
   * Start periodic sync
   */
  startPeriodicSync() {
    console.log('🔄 Starting periodic group sync service');
    
    // Do initial sync
    this.syncGroups();
    
    // Schedule periodic syncs
    this.syncTimer = setInterval(() => {
      this.syncGroups();
    }, this.syncInterval);
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('⏹️ Stopped periodic group sync');
    }
  }

  /**
   * Close database connection
   */
  async close() {
    this.stopPeriodicSync();
    await this.prisma.$disconnect();
  }
}

module.exports = { SignalGroupSyncService };