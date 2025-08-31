// Group ID mapping fix for onboarding plugin
// This maps between different group ID formats Signal uses

export const groupIdMappings = {
  // Entry/INDOC room - both formats Signal might use
  entryRoom: [
    'PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=', // Raw base64 from messages
    'UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=', // URL-safe from group list
    'group.UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=' // With prefix
  ],
  
  // Bot Development room - both formats
  botDevRoom: [
    '6PP/i0JBlXpAe+dkxvH64ZKmOQoeaukKtsPUQU5wQTg=', // Raw base64 from messages  
    'NlBQL2kwSkJsWHBBZStka3h2SDY0WkttT1FvZWF1a0t0c1BVUVU1d1FUZz0=', // URL-safe from group list
    'group.NlBQL2kwSkJsWHBBZStka3h2SDY0WkttT1FvZWF1a0t0c1BVUVU1d1FUZz0=' // With prefix
  ],
  
  // Mod Actions room
  modActionsRoom: [
    process.env.MOD_ACTIONS_ROOM_ID || 'group.K0J5N1NZQk9QR0V4Y0UyUHVCZUFHZHVqTExhWVR4Rzl5c2VUVkEvZDRkST0='
  ]
};

// Helper function to check if a group ID matches any known format
export function isGroupMatch(receivedId, roomType) {
  if (!receivedId || !roomType) return false;
  
  // Clean the received ID
  const cleanId = receivedId.replace(/^group\./, '');
  
  // Get the mappings for this room type
  const mappings = groupIdMappings[roomType] || [];
  
  // Check if received ID matches any mapping
  return mappings.some(mapping => {
    const cleanMapping = mapping.replace(/^group\./, '');
    return cleanId === cleanMapping;
  });
}

// Test function to verify mappings
export function testGroupIdMatch(groupId) {
  const results = {
    entryRoom: isGroupMatch(groupId, 'entryRoom'),
    botDevRoom: isGroupMatch(groupId, 'botDevRoom'),
    modActionsRoom: isGroupMatch(groupId, 'modActionsRoom')
  };
  
  console.log(`Testing group ID: ${groupId}`);
  console.log('Results:', results);
  
  return results;
}