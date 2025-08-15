import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('EMERGENCY SCHEMA FIX: Starting...');
    
    // Step 1: Drop old table
    await prisma.$executeRaw`DROP TABLE IF EXISTS "dashboard_settings" CASCADE`;
    
    // Step 2: Create new table
    await prisma.$executeRaw`
      CREATE TABLE "dashboard_settings" (
        "id" SERIAL PRIMARY KEY,
        "key" VARCHAR(255) UNIQUE NOT NULL,
        "value" JSONB NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    // Step 3: Insert settings one by one using the JSON format
    const settings = [
      ['nextauth_url', process.env.NEXTAUTH_URL],
      ['authentik_client_id', process.env.AUTHENTIK_CLIENT_ID],
      ['authentik_client_secret', process.env.AUTHENTIK_CLIENT_SECRET],
      ['authentik_issuer', process.env.AUTHENTIK_ISSUER],
      ['authentik_base_url', process.env.AUTHENTIK_BASE_URL],
      ['oidc_authorization_endpoint', process.env.OIDC_AUTHORIZATION_ENDPOINT],
      ['oidc_token_endpoint', process.env.OIDC_TOKEN_ENDPOINT],
      ['oidc_userinfo_endpoint', process.env.OIDC_USERINFO_ENDPOINT],
      ['oidc_end_session_endpoint', process.env.OIDC_END_SESSION_ENDPOINT],
      ['oidc_redirect_uri', process.env.OIDC_REDIRECT_URI],
    ];

    let inserted = 0;
    for (const [key, value] of settings) {
      if (value) {
        await prisma.$executeRaw`
          INSERT INTO "dashboard_settings" ("key", "value") 
          VALUES (${key}, ${value}::jsonb)
        `;
        inserted++;
      }
    }

    console.log('EMERGENCY SCHEMA FIX: Success!');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Emergency schema fix completed',
      settingsInserted: inserted
    });
  } catch (error) {
    console.error('EMERGENCY SCHEMA FIX failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}