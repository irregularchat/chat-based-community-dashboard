const fs = require('fs');

// Read the signal daemon log
const logContent = fs.readFileSync('signal-daemon.log', 'utf8');

// Find all receipt messages for timestamp 1756912257792
const targetTimestamp = '1756912257792';
const users = new Set();
const userDetails = [];

// Split into lines and process
const lines = logContent.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for lines containing our target timestamp in the "Timestamps:" section
    if (line.trim() === `- ${targetTimestamp} (2025-09-03T15:10:57.792Z)`) {
        console.log(`Found timestamp reference at line ${i + 1}: ${line}`);
        
        // Look backwards for the envelope line (should be a few lines before)
        for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
            const prevLine = lines[j];
            if (prevLine.includes('Envelope from:')) {
                console.log(`Found envelope at line ${j + 1}: ${prevLine}`);
                
                // Extract user info using a more flexible regex
                // Look for pattern: "Name" identifier (device: X) to
                const match = prevLine.match(/Envelope from: "([^"]*)" ([^\s]+) \(device: \d+\) to/);
                
                if (match) {
                    const name = match[1];
                    const identifier = match[2];
                    
                    if (!users.has(identifier)) {
                        users.add(identifier);
                        userDetails.push({
                            name: name,
                            identifier: identifier,
                            type: identifier.includes('+') ? 'phone' : 'uuid'
                        });
                        console.log(`✓ Added user: "${name}" - ${identifier}`);
                    } else {
                        console.log(`- Duplicate user: "${name}" - ${identifier}`);
                    }
                } else {
                    console.log(`❌ Could not parse envelope line: ${prevLine}`);
                }
                break; // Found the envelope for this timestamp
            }
        }
    }
}

// Save the results
const result = {
    timestamp: new Date().toISOString(),
    removalTimestamp: targetTimestamp,
    removalTime: new Date(parseInt(targetTimestamp)).toISOString(),
    totalUsers: userDetails.length,
    users: userDetails,
    identifiers: userDetails.map(u => u.identifier)
};

fs.writeFileSync('actual-removed-users-from-logs.json', JSON.stringify(result, null, 2));
console.log(`\n🎯 Extracted ${userDetails.length} users who were actually removed`);
console.log('📁 Saved to actual-removed-users-from-logs.json');

// Also save a simple text file with just identifiers for easy checking
fs.writeFileSync('actual-removed-users.txt', userDetails.map(u => `${u.name} (${u.identifier})`).join('\n'));
console.log('📁 Also saved readable list to actual-removed-users.txt');