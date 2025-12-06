/**
 * Test URL tracker removal with multiple platforms
 */

// Updated TRACKING_PARAMS matching url-security.ts
const TRACKING_PARAMS = [
  // Google Analytics
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  // Google Ads
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
  // Facebook/Meta
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source', 'sfnsn', 'mibextid', 'mibexttid', '_rdr',
  // LinkedIn
  'rcm', 'trk', 'trkInfo', 'lipi',
  // Twitter/X
  'twclid', 's', 't',
  // TikTok
  'tt_medium', 'tt_content',
  // MailChimp
  'mc_cid', 'mc_eid',
  // Yandex
  'yclid', '_openstat',
  // Other
  'ref', 'source', 'campaign', 'medium', 'action_object_map', 'action_type_map', 'action_ref_map',
  'hsCtaTracking', 'hsmi', '_hsenc', '_hsmi', 'vero_id', 'wickedid', 'oly_anon_id', 'oly_enc_id',
  'msclkid', 'igshid', 'igsh', 'share', 'sharesource'
];

function cleanURL(url) {
  try {
    const urlObj = new URL(url);
    const removedParams = [];
    let hasTracking = false;

    TRACKING_PARAMS.forEach(param => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.delete(param);
        removedParams.push(param);
        hasTracking = true;
      }
    });

    // Also check for parameters that start with utm_ or mc_ or tracking
    const allParams = Array.from(urlObj.searchParams.keys());
    allParams.forEach(param => {
      if ((param.startsWith('utm_') || param.startsWith('mc_') || param.includes('tracking')) && !removedParams.includes(param)) {
        urlObj.searchParams.delete(param);
        removedParams.push(param);
        hasTracking = true;
      }
    });

    return { cleaned: urlObj.toString(), hasTracking, removedParams };
  } catch (error) {
    return { cleaned: url, hasTracking: false, removedParams: [] };
  }
}

// Test URLs
const tests = [
  {
    name: 'LinkedIn URL',
    url: 'https://www.linkedin.com/posts/ashley--nicholson_the-200000-stanford-ai-degree-just-became-activity-7398394639310860288-_jQ0?utm_source=share&utm_medium=member_ios&rcm=ACoAABr6uxsB17yPu0ZCSFXTI4Dwr6f46xQeDL0',
    expected: ['utm_source', 'utm_medium', 'rcm']
  },
  {
    name: 'Facebook Mobile URL',
    url: 'https://m.facebook.com/groups/6138328615/permalink/10161989086423616/?sfnsn=wa&ref=share&mibextid=VhDh1V',
    expected: ['sfnsn', 'ref', 'mibextid']
  }
];

console.log('🧪 URL Tracker Removal Test\n');
console.log('═'.repeat(70) + '\n');

let allPassed = true;

tests.forEach((test, i) => {
  console.log(`Test ${i + 1}: ${test.name}`);
  console.log('─'.repeat(70));
  console.log('Original URL:');
  console.log(test.url);

  const result = cleanURL(test.url);

  console.log('\n✨ Cleaned URL:');
  console.log(result.cleaned);
  console.log('\n📊 Removed params:', result.removedParams.join(', ') || 'none');

  // Verify all expected params were removed
  const allRemoved = test.expected.every(param => result.removedParams.includes(param));
  const missing = test.expected.filter(param => !result.removedParams.includes(param));

  if (allRemoved) {
    console.log('✅ PASS: All expected trackers removed');
  } else {
    console.log(`❌ FAIL: Missing removal of: ${missing.join(', ')}`);
    allPassed = false;
  }

  console.log('\n' + '═'.repeat(70) + '\n');
});

if (allPassed) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('💥 Some tests failed');
  process.exit(1);
}
