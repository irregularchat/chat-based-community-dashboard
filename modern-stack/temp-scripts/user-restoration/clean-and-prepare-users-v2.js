const fs = require('fs');

// Read the extracted users
const rawData = JSON.parse(fs.readFileSync('final-removed-users.json', 'utf8'));

console.log(`Cleaning up ${rawData.totalUsers} extracted users...`);

// Clean up the names by removing "Envelope from: " prefix and quotes
const cleanedUsers = rawData.users.map(user => {
    let cleanName = user.name;
    
    // Remove "Envelope from: " prefix and surrounding quotes
    if (cleanName.startsWith('Envelope from: "') && cleanName.endsWith('"')) {
        cleanName = cleanName.substring('Envelope from: "'.length, cleanName.length - 1);
    }
    
    return {
        ...user,
        name: cleanName
    };
});

// Remove duplicates based on identifier
const uniqueUsers = [];
const seenIdentifiers = new Set();

for (const user of cleanedUsers) {
    if (!seenIdentifiers.has(user.identifier)) {
        seenIdentifiers.add(user.identifier);
        uniqueUsers.push(user);
    }
}

// Save the cleaned data
const cleanedResult = {
    timestamp: new Date().toISOString(),
    removalTimestamp: rawData.removalTimestamp,
    removalTime: rawData.removalTime,
    totalUsers: uniqueUsers.length,
    users: uniqueUsers,
    identifiers: uniqueUsers.map(u => u.identifier)
};

fs.writeFileSync('cleaned-removed-users.json', JSON.stringify(cleanedResult, null, 2));
fs.writeFileSync('cleaned-removed-users.txt', uniqueUsers.map(u => `${u.name} (${u.identifier})`).join('\n'));

console.log(`🧹 Cleaned and deduplicated to ${uniqueUsers.length} unique users`);
console.log('📄 Files saved:');
console.log('  - cleaned-removed-users.json');
console.log('  - cleaned-removed-users.txt');

// Show first few users as preview
console.log('\n📋 First 20 cleaned users:');
uniqueUsers.slice(0, 20).forEach((user, i) => {
    console.log(`  ${i + 1}. ${user.name} (${user.identifier})`);
});

if (uniqueUsers.length > 20) {
    console.log(`  ... and ${uniqueUsers.length - 20} more users`);
}

// Statistics
const phoneNumbers = uniqueUsers.filter(u => u.type === 'phone').length;
const uuids = uniqueUsers.filter(u => u.type === 'uuid').length;
console.log(`\n📊 Statistics:`);
console.log(`  Phone numbers: ${phoneNumbers}`);
console.log(`  UUIDs: ${uuids}`);
console.log(`  Total unique users: ${uniqueUsers.length}`);