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
        console.log(`Processing envelope: ${line}`);
        
        // Extract using the working logic from our test
        const fromIndex = line.indexOf('Envelope from: "');
        if (fromIndex === -1) continue;
        
        const nameStart = fromIndex + 'Envelope from: "'.length;
        const deviceMatch = line.match(/\s+([a-f0-9-]+|\+\d+)\s+\(device: \d+\)/);
        
        if (deviceMatch) {
            const identifier = deviceMatch[1];
            const beforeDevice = line.lastIndexOf(identifier);
            const nameSection = line.substring(nameStart, beforeDevice);
            const nameEnd = nameSection.lastIndexOf('"');
            
            if (nameEnd !== -1) {
                const name = nameSection.substring(0, nameEnd);
                
                if (!users.has(identifier)) {
                    users.set(identifier, {
                        name: name,
                        identifier: identifier,
                        type: identifier.includes('+') ? 'phone' : 'uuid'
                    });
                    console.log(`✅ Added: ${name} (${identifier})`);
                } else {
                    console.log(`⚪ Duplicate: ${name} (${identifier})`);
                }
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