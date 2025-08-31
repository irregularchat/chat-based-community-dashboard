// Group ID Normalization Module
// Critical for Signal CLI bot production deployment
// Handles the 3 different group ID formats that Signal randomly sends

class GroupIdNormalizer {
    constructor() {
        this.mappings = new Map();
        this.knownFormats = new Set();
    }

    /**
     * Normalize group ID to handle Signal's 3 different formats:
     * 1. Raw Base64: PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=
     * 2. URL-safe Base64: UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=
     * 3. With prefix: group.UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=
     */
    normalize(groupId) {
        if (!groupId) return null;
        
        // Check if already normalized and cached
        if (this.mappings.has(groupId)) {
            return this.mappings.get(groupId);
        }
        
        let normalized = groupId;
        
        // Remove 'group.' prefix if present
        if (normalized.startsWith('group.')) {
            normalized = normalized.substring(6);
        }
        
        // Convert from URL-safe base64 to regular base64 if needed
        try {
            // If it's URL-safe base64, convert to regular
            if (normalized.includes('-') || normalized.includes('_')) {
                normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
                // Add padding if needed
                while (normalized.length % 4) {
                    normalized += '=';
                }
            }
            
            // Store all known formats for this group
            this.knownFormats.add(groupId);
            this.knownFormats.add(normalized);
            this.knownFormats.add(`group.${normalized}`);
            
        } catch (error) {
            console.log(`⚠️ Could not normalize group ID: ${groupId}`, error);
        }
        
        // Cache the mapping (bidirectional)
        this.mappings.set(groupId, normalized);
        this.mappings.set(normalized, normalized);
        this.mappings.set(`group.${normalized}`, normalized);
        
        return normalized;
    }

    /**
     * Check if two group IDs refer to the same group
     */
    areEqual(groupId1, groupId2) {
        if (!groupId1 || !groupId2) return false;
        return this.normalize(groupId1) === this.normalize(groupId2);
    }

    /**
     * Get all known formats for a group ID
     */
    getAllFormats(groupId) {
        const normalized = this.normalize(groupId);
        if (!normalized) return [];
        
        return [
            normalized,
            `group.${normalized}`,
            this.toUrlSafe(normalized),
            `group.${this.toUrlSafe(normalized)}`
        ].filter(format => format !== null);
    }

    /**
     * Convert base64 to URL-safe format
     */
    toUrlSafe(base64) {
        if (!base64) return null;
        try {
            return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        } catch (error) {
            return null;
        }
    }

    /**
     * Add a known group mapping manually
     */
    addMapping(groupId, normalizedId) {
        this.mappings.set(groupId, normalizedId);
        this.knownFormats.add(groupId);
        this.knownFormats.add(normalizedId);
    }

    /**
     * Get statistics about cached mappings
     */
    getStats() {
        return {
            mappings: this.mappings.size,
            knownFormats: this.knownFormats.size
        };
    }

    /**
     * Clear all cached mappings
     */
    clear() {
        this.mappings.clear();
        this.knownFormats.clear();
    }

    /**
     * Export mappings for persistence
     */
    export() {
        return {
            mappings: Object.fromEntries(this.mappings),
            knownFormats: Array.from(this.knownFormats)
        };
    }

    /**
     * Import mappings from persistence
     */
    import(data) {
        if (data.mappings) {
            this.mappings = new Map(Object.entries(data.mappings));
        }
        if (data.knownFormats) {
            this.knownFormats = new Set(data.knownFormats);
        }
    }
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GroupIdNormalizer;
} else if (typeof exports !== 'undefined') {
    exports.GroupIdNormalizer = GroupIdNormalizer;
}

// Example usage and testing
if (require.main === module) {
    const normalizer = new GroupIdNormalizer();
    
    // Test cases from production
    const testCases = [
        'PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=',
        'UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=',
        'group.UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=',
        'group.K0J5N1NZQk9QR0V4Y0UyUHVCZUFHZHVqTExhWVR4Rzl5c2VUVkEvZDRkST0='
    ];
    
    console.log('🧪 Testing Group ID Normalizer...\n');
    
    testCases.forEach((testId, index) => {
        const normalized = normalizer.normalize(testId);
        const allFormats = normalizer.getAllFormats(testId);
        
        console.log(`Test ${index + 1}:`);
        console.log(`  Input: ${testId}`);
        console.log(`  Normalized: ${normalized}`);
        console.log(`  All formats: ${allFormats.length}`);
        allFormats.forEach(format => console.log(`    - ${format}`));
        console.log('');
    });
    
    console.log('📊 Final Stats:', normalizer.getStats());
}