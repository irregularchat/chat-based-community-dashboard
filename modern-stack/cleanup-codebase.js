#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🧹 Cleaning up codebase and organizing files...');
console.log('=' + '='.repeat(50));

// Create cleanup directories if they don't exist
const cleanupDirs = [
  'temp-scripts',
  'temp-scripts/user-restoration',
  'temp-scripts/testing',
  'temp-scripts/data-files'
];

cleanupDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// Files to organize (move to appropriate directories)
const fileOperations = [
  // User restoration scripts
  { pattern: /^(add-|restore-|extract-|clean-|emergency-).*\.(js|json|txt)$/, dest: 'temp-scripts/user-restoration/' },
  
  // Test scripts
  { pattern: /^test-.*\.(js|json)$/, dest: 'temp-scripts/testing/' },
  { pattern: /^(verify-|check-|debug-).*\.(js|py)$/, dest: 'temp-scripts/testing/' },
  
  // Data files
  { pattern: /^(actual-|cleaned-|final-|individual-|removed-).*\.(json|txt)$/, dest: 'temp-scripts/data-files/' },
  { pattern: /^(candidate-|current-|counter-uxv-).*\.json$/, dest: 'temp-scripts/data-files/' },
  { pattern: /^(restoration-|real-).*\.json$/, dest: 'temp-scripts/data-files/' },
  
  // Command files
  { pattern: /^(ping-command|removeuser-command)\.json$/, dest: 'temp-scripts/data-files/' },
  
  // Comparison and listing scripts
  { pattern: /^(compare-|list-).*\.js$/, dest: 'temp-scripts/testing/' },
  { pattern: /^send-.*\.js$/, dest: 'temp-scripts/testing/' }
];

// Get all files in current directory
const allFiles = fs.readdirSync('.');

let movedCount = 0;
let keptCount = 0;

allFiles.forEach(file => {
  // Skip directories, hidden files, and important files
  if (fs.statSync(file).isDirectory()) return;
  if (file.startsWith('.')) return;
  
  // Keep important files
  const keepFiles = [
    'package.json',
    'package-lock.json',
    '.env.local',
    '.gitignore',
    'README.md',
    'LESSONS_LEARNED.md',
    'FIXES_SUMMARY.md',
    'SIGNAL_GROUP_USER_ADDITION_RESEARCH.md',
    'cleanup-codebase.js'
  ];
  
  if (keepFiles.includes(file)) {
    keptCount++;
    return;
  }
  
  // Find matching pattern and move file
  for (const operation of fileOperations) {
    if (operation.pattern.test(file)) {
      const destPath = path.join(operation.dest, file);
      try {
        fs.renameSync(file, destPath);
        console.log(`📁 Moved: ${file} → ${operation.dest}`);
        movedCount++;
      } catch (error) {
        console.log(`❌ Failed to move ${file}: ${error.message}`);
      }
      return;
    }
  }
  
  // If no pattern matches, check if it's a temporary file we should move
  if (file.endsWith('.js') && !file.startsWith('start-') && !file.includes('native-signal-bot')) {
    const destPath = path.join('temp-scripts/', file);
    try {
      fs.renameSync(file, destPath);
      console.log(`📁 Moved: ${file} → temp-scripts/`);
      movedCount++;
    } catch (error) {
      console.log(`❌ Failed to move ${file}: ${error.message}`);
    }
  }
});

console.log('\n📊 Cleanup Summary:');
console.log(`   📁 Files moved: ${movedCount}`);
console.log(`   📄 Files kept in root: ${keptCount}`);
console.log(`   🗂️ Created ${cleanupDirs.length} organization directories`);

// Create a README for the temp-scripts directory
const readmeContent = `# Temporary Scripts and Data Files

This directory contains temporary files generated during the Signal bot restoration work:

## Directories:

- **user-restoration/**: Scripts for restoring removed users to Counter UXV group
- **testing/**: Test scripts for debugging and verification
- **data-files/**: JSON and text files with user data and results

## Important Notes:

- These files were part of debugging the accidental user removal incident
- Most are no longer needed but kept for reference
- The successful restoration approach is documented in LESSONS_LEARNED.md
- Signal bot is now operational with restored functionality

Generated on ${new Date().toISOString()}
`;

fs.writeFileSync('temp-scripts/README.md', readmeContent);
console.log('\n📋 Created temp-scripts/README.md with documentation');

console.log('\n✅ Codebase cleanup completed!');