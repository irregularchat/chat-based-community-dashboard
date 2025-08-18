/**
 * Enhanced Signal API Client
 * Adds caching and display name resolution to Signal API calls
 */

import { signalIdentityCache } from './identity-cache';

const SIGNAL_BASE_URL = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';

interface SignalGroup {
  id: string;
  name: string;
  description?: string;
  members: string[];
  admins: string[];
  memberCount?: number;
  displayMembers?: Array<{ id: string; displayName: string }>;
}

interface SignalUser {
  id: string;
  displayName: string;
  phoneNumber?: string;
  isRegistered?: boolean;
}

export class EnhancedSignalApiClient {
  private baseUrl: string;
  private phoneNumber: string | null = null;
  private identitiesFetched = false;
  private lastIdentityFetch = 0;
  private identityFetchInterval = 5 * 60 * 1000; // 5 minutes

  constructor(baseUrl: string = SIGNAL_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Set the phone number for the current session
   */
  setPhoneNumber(phoneNumber: string) {
    this.phoneNumber = phoneNumber;
  }

  /**
   * Fetch and cache identities and contacts
   */
  private async fetchIdentities(): Promise<void> {
    if (!this.phoneNumber) return;
    
    const now = Date.now();
    if (this.identitiesFetched && (now - this.lastIdentityFetch) < this.identityFetchInterval) {
      return; // Use cached data
    }

    try {
      // Fetch basic identities for UUID mappings
      const identitiesResponse = await fetch(`${this.baseUrl}/v1/identities/${this.phoneNumber}`);
      if (identitiesResponse.ok) {
        const identities = await identitiesResponse.json();
        signalIdentityCache.updateIdentities(identities);
        console.log(`Cached ${identities.length} Signal identities`);
      }

      // Fetch contacts for profile information (display names)
      const contactsResponse = await fetch(`${this.baseUrl}/v1/contacts/${this.phoneNumber}`);
      if (contactsResponse.ok) {
        const contacts = await contactsResponse.json();
        signalIdentityCache.updateContacts(contacts);
        console.log(`Cached ${contacts.length} Signal contacts with profile info`);
      }

      this.identitiesFetched = true;
      this.lastIdentityFetch = now;
    } catch (error) {
      console.error('Failed to fetch Signal identities/contacts:', error);
    }
  }

  /**
   * Get groups with enhanced member information
   */
  async getGroupsWithNames(): Promise<SignalGroup[]> {
    if (!this.phoneNumber) {
      throw new Error('Phone number not set');
    }

    // Fetch identities first to populate cache
    await this.fetchIdentities();

    try {
      const response = await fetch(`${this.baseUrl}/v1/groups/${this.phoneNumber}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch groups: ${response.status}`);
      }

      const groups = await response.json();
      
      // Enhance groups with display names
      return groups.map((group: any) => ({
        id: group.id,
        name: group.name || 'Unnamed Group',
        description: group.description,
        members: group.members,
        admins: group.admins || [],
        memberCount: group.members?.length || 0,
        displayMembers: group.members?.map((member: string) => ({
          id: member,
          displayName: signalIdentityCache.getDisplayName(member)
        }))
      }));
    } catch (error) {
      console.error('Error fetching groups:', error);
      return [];
    }
  }

  /**
   * Get users with display names
   */
  async getUsersWithNames(): Promise<SignalUser[]> {
    if (!this.phoneNumber) {
      throw new Error('Phone number not set');
    }

    // Fetch identities to populate cache
    await this.fetchIdentities();

    try {
      const response = await fetch(`${this.baseUrl}/v1/identities/${this.phoneNumber}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch identities: ${response.status}`);
      }

      const identities = await response.json();
      
      // Convert to user format with display names
      return identities.map((identity: any) => ({
        id: identity.uuid || identity.number,
        displayName: signalIdentityCache.getDisplayName(identity.number),
        phoneNumber: identity.number,
        isRegistered: identity.status !== 'UNREGISTERED'
      }));
    } catch (error) {
      console.error('Error fetching users:', error);
      return [];
    }
  }

  /**
   * Send message with recipient name resolution
   */
  async sendMessage(recipients: string[], message: string): Promise<boolean> {
    if (!this.phoneNumber) {
      throw new Error('Phone number not set');
    }

    try {
      const response = await fetch(`${this.baseUrl}/v2/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          number: this.phoneNumber,
          recipients
        })
      });

      return response.ok;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }

  /**
   * Get display name for a single user
   */
  getDisplayName(identifier: string): string {
    return signalIdentityCache.getDisplayName(identifier);
  }

  /**
   * Clear all caches
   */
  clearCache() {
    signalIdentityCache.clear();
    this.identitiesFetched = false;
    this.lastIdentityFetch = 0;
  }
}

// Export singleton instance
export const enhancedSignalClient = new EnhancedSignalApiClient();