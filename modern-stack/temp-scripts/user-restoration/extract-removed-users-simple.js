const fs = require('fs');

// Read the signal daemon log
const logContent = fs.readFileSync('signal-daemon.log', 'utf8');

const targetTimestamp = '1756912257792';
const users = new Map(); // Use Map to avoid duplicates and store details
const lines = logContent.split('\n');

console.log(`Searching for users who received message timestamp ${targetTimestamp}...`);

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for our target timestamp
    if (line.includes(targetTimestamp)) {
        // Look backwards for the envelope line
        for (let j = Math.max(0, i - 10); j < i; j++) {
            const prevLine = lines[j];
            if (prevLine.includes('Envelope from:')) {
                // Extract using simple string manipulation
                const envelopeMatch = prevLine.match(/Envelope from: "([^"]*)" ([^\s]+) \(device: \d+\)/);
                if (envelopeMatch) {
                    const name = envelopeMatch[1];
                    const identifier = envelopeMatch[2];
                    
                    if (!users.has(identifier)) {
                        users.set(identifier, {
                            name: name,
                            identifier: identifier,
                            type: identifier.includes('+') ? 'phone' : 'uuid'
                        });
                        console.log(`Found: ${name} (${identifier})`);
                    }
                }
                break;
            }
        }
    }
}

const userList = Array.from(users.values());

// Save results
const result = {
    timestamp: new Date().toISOString(),
    removalTimestamp: targetTimestamp,
    removalTime: new Date(parseInt(targetTimestamp)).toISOString(),
    totalUsers: userList.length,
    users: userList,
    identifiers: userList.map(u => u.identifier)
};

fs.writeFileSync('extracted-removed-users.json', JSON.stringify(result, null, 2));
fs.writeFileSync('extracted-removed-users.txt', userList.map(u => `${u.name} (${u.identifier})`).join('\n'));

console.log(`\n🎯 Successfully extracted ${userList.length} users who were removed!`);
console.log('📄 Files saved:');
console.log('  - extracted-removed-users.json');
console.log('  - extracted-removed-users.txt');

// Show first few users as preview
console.log('\n📋 First 10 users:');
userList.slice(0, 10).forEach((user, i) => {
    console.log(`  ${i + 1}. ${user.name} (${user.identifier})`);
});

if (userList.length > 10) {
    console.log(`  ... and ${userList.length - 10} more users`);
}