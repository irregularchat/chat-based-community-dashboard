import { PostgresClient } from '../db/postgres-client.js';

export async function isAdmin(db: PostgresClient, identifier: string | undefined): Promise<boolean> {
  if (!identifier) {
    return false;
  }

  const admins = (process.env.ADMIN_PHONE_NUMBERS || '')
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  // Also check ADMIN_UUIDS env var for direct UUID matches
  const adminUuids = (process.env.ADMIN_UUIDS || '')
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  if (admins.length === 0 && adminUuids.length === 0) {
    console.error('⚠️  SECURITY WARNING: No admin identifiers configured in ADMIN_PHONE_NUMBERS or ADMIN_UUIDS');
    return false;
  }

  // Direct match in admin list (phone number or UUID)
  const identifierLower = identifier.toLowerCase();
  if (admins.includes(identifierLower) || adminUuids.includes(identifierLower)) {
    console.log(`✅ Admin check passed for direct match: ${identifier}`);
    return true;
  }

  // If identifier looks like a UUID, also check for matching phone number
  // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const isUuid = identifier.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  if (isUuid && db) {
    try {
      console.log(`🔍 Looking up phone number for UUID: ${identifier}`);
      const result = await db.query(
        'SELECT phone_number FROM signal_members WHERE uuid = $1 LIMIT 1',
        [identifier]
      );

      if (result.results && result.results.length > 0 && result.results[0].phone_number) {
        const phoneNumber = result.results[0].phone_number;
        console.log(`📱 Found phone number for UUID: ${phoneNumber}`);

        if (admins.includes(phoneNumber.toLowerCase())) {
          console.log(`✅ Admin check passed for UUID → phone number: ${phoneNumber}`);
          return true;
        } else {
          console.log(`❌ Phone number ${phoneNumber} is not in admin list`);
        }
      } else {
        console.log(`⚠️  No phone number found for UUID: ${identifier}`);
      }
    } catch (error) {
      console.error('❌ Database lookup failed during admin check:', error);
    }
  }

  console.log(`❌ Admin check failed for identifier: ${identifier}`);
  return false;
}
