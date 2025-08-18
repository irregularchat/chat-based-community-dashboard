/**
 * Signal Identity Cache
 * Manages phone number to UUID mappings and display names for Signal users
 */

interface SignalContact {
  number: string;
  uuid: string;
  name: string;
  profile_name: string;
  username: string;
  profile: {
    given_name: string;
    lastname: string;
    about: string;
    has_avatar: boolean;
    last_updated_timestamp: number;
  };
  given_name: string;
  nickname: {
    name: string;
    given_name: string;
    family_name: string;
  };
}

interface SignalIdentity {
  number: string;
  uuid: string;
  displayName?: string;
  profileName?: string;
  username?: string;
  givenName?: string;
  lastName?: string;
  nickname?: string;
  fingerprint?: string;
  status?: string;
  lastUpdated: number;
}

class SignalIdentityCache {
  private cache: Map<string, SignalIdentity> = new Map();
  private phoneToUuid: Map<string, string> = new Map();
  private uuidToPhone: Map<string, string> = new Map();
  private ttl = 5 * 60 * 1000; // 5 minutes TTL

  /**
   * Update cache with identities from Signal API
   */
  updateIdentities(identities: any[]) {
    const now = Date.now();
    
    for (const identity of identities) {
      const signalIdentity: SignalIdentity = {
        number: identity.number,
        uuid: identity.uuid,
        fingerprint: identity.fingerprint,
        status: identity.status,
        lastUpdated: now
      };
      
      // Store by both phone and UUID for quick lookups
      this.cache.set(identity.number, signalIdentity);
      this.cache.set(identity.uuid, signalIdentity);
      
      // Maintain bidirectional mappings
      this.phoneToUuid.set(identity.number, identity.uuid);
      this.uuidToPhone.set(identity.uuid, identity.number);
    }
  }

  /**
   * Update cache with contacts (profile information) from Signal API
   */
  updateContacts(contacts: SignalContact[]) {
    const now = Date.now();
    
    for (const contact of contacts) {
      // Create identity with profile information
      const signalIdentity: SignalIdentity = {
        number: contact.number,
        uuid: contact.uuid,
        profileName: contact.profile_name || contact.name,
        username: contact.username,
        givenName: contact.profile?.given_name || contact.given_name || contact.nickname?.given_name,
        lastName: contact.profile?.lastname || contact.nickname?.family_name,
        nickname: contact.nickname?.name,
        lastUpdated: now
      };
      
      // Determine best display name
      signalIdentity.displayName = this.determineBestDisplayName(signalIdentity);
      
      // Store by both phone and UUID for quick lookups
      this.cache.set(contact.number, signalIdentity);
      this.cache.set(contact.uuid, signalIdentity);
      
      // Maintain bidirectional mappings
      this.phoneToUuid.set(contact.number, contact.uuid);
      this.uuidToPhone.set(contact.uuid, contact.number);
    }
  }

  /**
   * Determine the best display name from available profile information
   */
  private determineBestDisplayName(identity: SignalIdentity): string {
    // Priority order: nickname > given name + last name > profile name > username > formatted phone
    if (identity.nickname) {
      return identity.nickname;
    }
    
    if (identity.givenName) {
      const fullName = identity.lastName 
        ? `${identity.givenName} ${identity.lastName}`.trim()
        : identity.givenName;
      return fullName;
    }
    
    if (identity.profileName) {
      return identity.profileName;
    }
    
    if (identity.username) {
      return `@${identity.username}`;
    }
    
    // Fallback to formatted phone number
    return this.formatPhoneNumber(identity.number);
  }

  /**
   * Get display name for a user (phone number or UUID)
   */
  getDisplayName(identifier: string): string {
    // First check if it's a phone number
    if (identifier.startsWith('+')) {
      return this.formatPhoneNumber(identifier);
    }
    
    // Check cache for UUID
    const identity = this.cache.get(identifier);
    if (identity) {
      // Return display name if available, otherwise formatted phone number
      return identity.displayName || this.formatPhoneNumber(identity.number);
    }
    
    // Check if we can map UUID to phone
    const phoneNumber = this.uuidToPhone.get(identifier);
    if (phoneNumber) {
      return this.formatPhoneNumber(phoneNumber);
    }
    
    // Return shortened UUID as last resort
    return this.shortenUuid(identifier);
  }

  /**
   * Format phone number for display
   */
  private formatPhoneNumber(phone: string): string {
    if (!phone || !phone.startsWith('+')) return phone;
    
    // Format US numbers as (XXX) XXX-XXXX
    if (phone.startsWith('+1') && phone.length === 12) {
      const areaCode = phone.substring(2, 5);
      const prefix = phone.substring(5, 8);
      const suffix = phone.substring(8);
      return `(${areaCode}) ${prefix}-${suffix}`;
    }
    
    // Return as-is for international numbers
    return phone;
  }

  /**
   * Shorten UUID for display
   */
  private shortenUuid(uuid: string): string {
    if (!uuid || uuid.length < 8) return uuid;
    return `User ${uuid.substring(0, 8)}...`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isValid(identity: SignalIdentity): boolean {
    return Date.now() - identity.lastUpdated < this.ttl;
  }

  /**
   * Clear expired entries
   */
  cleanupExpired() {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, identity] of this.cache) {
      if (now - identity.lastUpdated > this.ttl) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      const identity = this.cache.get(key);
      if (identity) {
        this.cache.delete(identity.number);
        this.cache.delete(identity.uuid);
        this.phoneToUuid.delete(identity.number);
        this.uuidToPhone.delete(identity.uuid);
      }
    }
  }

  /**
   * Get phone number from UUID
   */
  getPhoneNumber(uuid: string): string | undefined {
    return this.uuidToPhone.get(uuid);
  }

  /**
   * Get UUID from phone number
   */
  getUuid(phoneNumber: string): string | undefined {
    return this.phoneToUuid.get(phoneNumber);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
    this.phoneToUuid.clear();
    this.uuidToPhone.clear();
  }
}

// Export singleton instance
export const signalIdentityCache = new SignalIdentityCache();