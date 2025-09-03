const { execSync } = require('child_process');
const fs = require('fs');

const targetTimestamp = '1756912257792';
console.log(`Extracting users who received message timestamp ${targetTimestamp}...`);

// Use grep to get the relevant lines from the log
console.log('Running grep to find timestamp occurrences...');
const grepResult = execSync(`grep -A 10 "${targetTimestamp}" signal-daemon.log`, { encoding: 'utf8' });

const lines = grepResult.split('\n');
const users = new Map();

console.log(`Found ${lines.length} lines from grep...`);

// Process the grep output
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines and separators
    if (!line.trim() || line.startsWith('--')) continue;
    
    // Look for envelope lines
    if (line.includes('Envelope from:')) {
        console.log(`Processing: ${line.substring(0, 80)}...`);
        
        // Use a different approach: split on spaces and work backwards
        const parts = line.split(' ');
        let deviceIndex = -1;
        for (let j = 0; j < parts.length; j++) {
            if (parts[j] === '(device:') {
                deviceIndex = j;
                break;
            }
        }
        
        if (deviceIndex > 0) {
            // The identifier is right before (device:
            const identifier = parts[deviceIndex - 1];
            
            // Extract everything between the first quote and the identifier
            const quoteStart = line.indexOf('"') + 1;
            const identifierStart = line.indexOf(identifier);
            const beforeIdentifier = line.substring(quoteStart, identifierStart).trim();
            
            // Remove the trailing quote
            const name = beforeIdentifier.replace(/"+$/, '');
            
            if (identifier && name && !users.has(identifier)) {
                users.set(identifier, {
                    name: name,
                    identifier: identifier,
                    type: identifier.includes('+') ? 'phone' : 'uuid'
                });
                console.log(`✅ Added: "${name}" (${identifier})`);
            }
        } else {
            console.log(`❌ Could not parse device pattern`);
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

fs.writeFileSync('final-removed-users.json', JSON.stringify(result, null, 2));
fs.writeFileSync('final-removed-users.txt', userList.map(u => `${u.name} (${u.identifier})`).join('\n'));

console.log(`\n🎯 Successfully extracted ${userList.length} users who were removed!`);
console.log('📄 Files saved:');
console.log('  - final-removed-users.json');
console.log('  - final-removed-users.txt');

// Show first few users as preview
console.log('\n📋 First 20 users:');
userList.slice(0, 20).forEach((user, i) => {
    console.log(`  ${i + 1}. ${user.name} (${user.identifier})`);
});

if (userList.length > 20) {
    console.log(`  ... and ${userList.length - 20} more users`);
}