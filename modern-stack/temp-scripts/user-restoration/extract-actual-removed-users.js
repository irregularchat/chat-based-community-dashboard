const fs = require('fs');

// Read the signal daemon log
const logContent = fs.readFileSync('signal-daemon.log', 'utf8');

// Find all receipt messages for timestamp 1756912257792
const targetTimestamp = '1756912257792';
const users = new Set();
const userDetails = [];

// Split into lines and process
const lines = logContent.split('\n');
let i = 0;

while (i < lines.length) {
    const line = lines[i];
    
    // Look for receipt messages with our target timestamp
    if (line.includes('Received a receipt message') && 
        i + 10 < lines.length && // Make sure we have enough lines to look ahead
        lines.slice(i, i + 10).some(l => l.includes(targetTimestamp))) {
        
        // Look for the envelope line which contains the user info
        let envelopeLineIndex = i + 1;
        while (envelopeLineIndex < lines.length && envelopeLineIndex < i + 15) {
            const envelopeLine = lines[envelopeLineIndex];
            if (envelopeLine.includes('Envelope from:')) {
                // Extract user info from envelope line
                // Format: Envelope from: "Name" uuid (device: X) to +19108471202
                const match = envelopeLine.match(/Envelope from: "([^"]*)" ([a-f0-9-]+|\+\d+) \(device: \d+\) to/);
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
                        console.log(`Found user: "${name}" - ${identifier}`);
                    }
                }
                break;
            }
            envelopeLineIndex++;
        }
    }
    i++;
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
console.log(`\nExtracted ${userDetails.length} users who were actually removed`);
console.log('Saved to actual-removed-users-from-logs.json');