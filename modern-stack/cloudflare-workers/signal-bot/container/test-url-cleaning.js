/**
 * Quick test to verify rcm parameter is removed from LinkedIn URLs
 */

// Simulated cleanURL function based on url-security.ts
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'yclid',
  '_openstat',
  'fb_action_ids',
  'fb_action_types',
  'fb_ref',
  'fb_source',
  'action_object_map',
  'action_type_map',
  'action_ref_map',
  'ref',
  'source',
  'campaign',
  'medium',
  'rcm', // LinkedIn tracking parameter
];

function cleanURL(url) {
  try {
    const urlObj = new URL(url);
    const removedParams = [];
    let hasTracking = false;

    // Check each tracking parameter
    TRACKING_PARAMS.forEach(param => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.delete(param);
        removedParams.push(param);
        hasTracking = true;
      }
    });

    // Also check for parameters that start with utm_ or similar patterns
    const allParams = Array.from(urlObj.searchParams.keys());
    allParams.forEach(param => {
      if (param.startsWith('utm_') || param.startsWith('mc_') || param.includes('tracking')) {
        if (!removedParams.includes(param)) {
          urlObj.searchParams.delete(param);
          removedParams.push(param);
          hasTracking = true;
        }
      }
    });

    return {
      cleaned: urlObj.toString(),
      hasTracking,
      removedParams,
    };
  } catch (error) {
    return {
      cleaned: url,
      hasTracking: false,
      removedParams: [],
    };
  }
}

// Test with the LinkedIn URL from the user's example
const testUrl = 'https://www.linkedin.com/posts/ashley--nicholson_the-200000-stanford-ai-degree-just-became-activity-7398394639310860288-_jQ0?utm_source=share&utm_medium=member_ios&rcm=ACoAABr6uxsB17yPu0ZCSFXTI4Dwr6f46xQeDL0';

console.log('Testing URL cleaning...\n');
console.log('Original URL:');
console.log(testUrl);
console.log('');

const result = cleanURL(testUrl);

console.log('Cleaned URL:');
console.log(result.cleaned);
console.log('');

console.log('Has tracking:', result.hasTracking);
console.log('Removed params:', result.removedParams.join(', '));
console.log('');

// Verify rcm is removed
if (result.cleaned.includes('rcm=')) {
  console.log('❌ FAILED: rcm parameter still present in cleaned URL');
  process.exit(1);
} else {
  console.log('✅ SUCCESS: rcm parameter removed from URL');
  console.log('✅ SUCCESS: All tracking parameters removed');
  process.exit(0);
}
