#!/usr/bin/env node

/**
 * Test script for enhanced Signal client with display names
 */

const SIGNAL_BASE_URL = 'http://localhost:50240';
const PHONE_NUMBER = '+19108471202';

// Simple identity cache for testing
class IdentityCache {
  constructor() {
    this.cache = new Map();
    this.phoneToUuid = new Map();
    this.uuidToPhone = new Map();
  }

  updateIdentities(identities) {
    for (const identity of identities) {
      this.cache.set(identity.number, identity);
      this.cache.set(identity.uuid, identity);
      this.phoneToUuid.set(identity.number, identity.uuid);
      this.uuidToPhone.set(identity.uuid, identity.number);
    }
  }

  updateContacts(contacts) {
    for (const contact of contacts) {
      // Extract best display name from profile
      const displayName = this.determineBestDisplayName(contact);
      
      const enrichedContact = {
        ...contact,
        displayName
      };
      
      this.cache.set(contact.number, enrichedContact);
      this.cache.set(contact.uuid, enrichedContact);
      this.phoneToUuid.set(contact.number, contact.uuid);
      this.uuidToPhone.set(contact.uuid, contact.number);
    }
  }

  determineBestDisplayName(contact) {
    // Priority: nickname > given name + last name > profile name > username > formatted phone
    if (contact.nickname?.name) {
      return contact.nickname.name;
    }
    
    const givenName = contact.profile?.given_name || contact.given_name || contact.nickname?.given_name;
    const lastName = contact.profile?.lastname || contact.nickname?.family_name;
    
    if (givenName) {
      return lastName ? `${givenName} ${lastName}`.trim() : givenName;
    }
    
    if (contact.profile_name || contact.name) {
      return contact.profile_name || contact.name;
    }
    
    if (contact.username) {
      return `@${contact.username}`;
    }
    
    return this.formatPhoneNumber(contact.number);
  }

  getDisplayName(identifier) {
    // Check cache first for enhanced profile data
    const cached = this.cache.get(identifier);
    if (cached && cached.displayName) {
      return cached.displayName;
    }
    
    // Phone number - check if we have profile data
    if (identifier.startsWith('+')) {
      return this.formatPhoneNumber(identifier);
    }
    
    // UUID - try to find phone number and check for profile
    const phoneNumber = this.uuidToPhone.get(identifier);
    if (phoneNumber) {
      const phoneContact = this.cache.get(phoneNumber);
      if (phoneContact && phoneContact.displayName) {
        return phoneContact.displayName;
      }
      return this.formatPhoneNumber(phoneNumber);
    }
    
    // Shorten UUID for display
    if (identifier.length > 8) {
      return `User ${identifier.substring(0, 8)}...`;
    }
    
    return identifier;
  }

  formatPhoneNumber(phone) {
    if (!phone || !phone.startsWith('+')) return phone;
    
    // Format US numbers
    if (phone.startsWith('+1') && phone.length === 12) {
      const areaCode = phone.substring(2, 5);
      const prefix = phone.substring(5, 8);
      const suffix = phone.substring(8);
      return `(${areaCode}) ${prefix}-${suffix}`;
    }
    
    return phone;
  }
}

async function testEnhancedClient() {
  console.log('🧪 Testing Enhanced Signal Client with Display Names\n');
  
  const cache = new IdentityCache();
  
  try {
    // Step 1: Fetch identities
    console.log('📥 Fetching identities...');
    const identitiesResponse = await fetch(`${SIGNAL_BASE_URL}/v1/identities/${PHONE_NUMBER}`);
    const identities = await identitiesResponse.json();
    
    console.log(`Found ${identities.length} identities\n`);
    
    // Update cache with identities
    cache.updateIdentities(identities);
    
    // Step 1.5: Fetch contacts for profile information
    console.log('📱 Fetching contacts with profile info...');
    const contactsResponse = await fetch(`${SIGNAL_BASE_URL}/v1/contacts/${PHONE_NUMBER}`);
    
    if (!contactsResponse.ok) {
      console.log('Failed to fetch contacts, continuing with identities only\n');
      return;
    }
    
    const contacts = await contactsResponse.json();
    
    if (!Array.isArray(contacts)) {
      console.log('Contacts response is not an array, continuing with identities only\n');
      return;
    }
    
    console.log(`Found ${contacts.length} contacts with profiles\n`);
    
    // Update cache with contacts
    cache.updateContacts(contacts);
    
    // Display contact profiles
    console.log('👤 Contact Profiles:');
    contacts.forEach(contact => {
      const displayName = cache.determineBestDisplayName(contact);
      const profileInfo = contact.profile?.given_name ? 
        `Profile: ${contact.profile.given_name} ${contact.profile.lastname || ''}`.trim() : 
        'No profile';
      console.log(`  ${displayName} (${profileInfo})`);
      console.log(`    Number: ${contact.number}`);
      console.log(`    UUID: ${contact.uuid.substring(0, 8)}...`);
      if (contact.username) console.log(`    Username: @${contact.username}`);
      console.log();
    });
    
    // Display identity mappings
    console.log('👥 Enhanced Identity Mappings:');
    identities.slice(0, 5).forEach(identity => {
      console.log(`  ${cache.getDisplayName(identity.number)} <-> ${identity.uuid.substring(0, 8)}...`);
    });
    console.log();
    
    // Step 2: Fetch groups with enhanced names
    console.log('📱 Fetching groups...');
    const groupsResponse = await fetch(`${SIGNAL_BASE_URL}/v1/groups/${PHONE_NUMBER}`);
    const groups = await groupsResponse.json();
    
    console.log(`Found ${groups.length} groups\n`);
    
    // Display groups with member names
    groups.forEach(group => {
      console.log(`📁 Group: ${group.name || 'Unnamed Group'}`);
      console.log(`   ID: ${group.id.substring(0, 40)}...`);
      console.log(`   Members (${group.members.length}):`);
      
      // Show first 5 members with display names
      group.members.slice(0, 5).forEach(member => {
        const displayName = cache.getDisplayName(member);
        console.log(`     • ${displayName}`);
      });
      
      if (group.members.length > 5) {
        console.log(`     ... and ${group.members.length - 5} more`);
      }
      console.log();
    });
    
    // Step 3: Test performance
    console.log('⚡ Performance Test:');
    const startTime = Date.now();
    
    // Resolve 100 random lookups
    for (let i = 0; i < 100; i++) {
      const randomIdentity = identities[Math.floor(Math.random() * identities.length)];
      if (randomIdentity) {
        cache.getDisplayName(randomIdentity.uuid);
        cache.getDisplayName(randomIdentity.number);
      }
    }
    
    const endTime = Date.now();
    console.log(`  Resolved 200 names in ${endTime - startTime}ms`);
    console.log(`  Average: ${((endTime - startTime) / 200).toFixed(2)}ms per lookup\n`);
    
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testEnhancedClient();