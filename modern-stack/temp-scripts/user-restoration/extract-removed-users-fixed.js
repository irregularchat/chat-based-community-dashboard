const fs = require('fs');

// Read the signal daemon log
const logContent = fs.readFileSync('signal-daemon.log', 'utf8');

const targetTimestamp = '1756912257792';
const users = new Map(); // Use Map to avoid duplicates and store details
const lines = logContent.split('\n');

console.log(`Searching for users who received message timestamp ${targetTimestamp}...`);

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for the exact timestamp line in the Timestamps: section
    if (line.trim() === `- ${targetTimestamp} (2025-09-03T15:10:57.792Z)`) {
        console.log(`Found timestamp at line ${i + 1}`);
        
        // Look FORWARDS for the envelope line (it comes after the timestamp)
        for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
            const nextLine = lines[j];
            if (nextLine.includes('Envelope from:')) {
                console.log(`Found envelope at line ${j + 1}: ${nextLine}`);
                
                // Extract using regex
                const envelopeMatch = nextLine.match(/Envelope from: "([^"]*)" ([^\s]+) \(device: \d+\)/);
                if (envelopeMatch) {
                    const name = envelopeMatch[1];
                    const identifier = envelopeMatch[2];
                    
                    if (!users.has(identifier)) {
                        users.set(identifier, {
                            name: name,
                            identifier: identifier,
                            type: identifier.includes('+') ? 'phone' : 'uuid'
                        });
                        console.log(`✅ Added: ${name} (${identifier})`);
                    } else {
                        console.log(`⚪ Already added: ${name} (${identifier})`);
                    }
                } else {
                    console.log(`❌ Could not parse envelope: ${nextLine}`);
                }
                break; // Found the envelope for this timestamp
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