import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('QUICK SCHEMA FIX: Updating dashboard_settings table...');
    
    // First, drop the existing table
    await prisma.$executeRaw`DROP TABLE IF EXISTS "dashboard_settings" CASCADE;`;
    
    // Create the new table with correct schema
    await prisma.$executeRaw`
      CREATE TABLE "dashboard_settings" (
        "id" SERIAL PRIMARY KEY,
        "key" VARCHAR(255) UNIQUE NOT NULL,
        "value" JSONB NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Add environment variables one by one
    const envVars = [
      { key: 'nextauth_url', value: process.env.NEXTAUTH_URL },
      { key: 'authentik_client_id', value: process.env.AUTHENTIK_CLIENT_ID },
      { key: 'authentik_client_secret', value: process.env.AUTHENTIK_CLIENT_SECRET },
      { key: 'authentik_issuer', value: process.env.AUTHENTIK_ISSUER },
      { key: 'authentik_base_url', value: process.env.AUTHENTIK_BASE_URL },
      { key: 'oidc_authorization_endpoint', value: process.env.OIDC_AUTHORIZATION_ENDPOINT },
      { key: 'oidc_token_endpoint', value: process.env.OIDC_TOKEN_ENDPOINT },
      { key: 'oidc_userinfo_endpoint', value: process.env.OIDC_USERINFO_ENDPOINT },
      { key: 'oidc_end_session_endpoint', value: process.env.OIDC_END_SESSION_ENDPOINT },
      { key: 'oidc_redirect_uri', value: process.env.OIDC_REDIRECT_URI },
    ];

    const populatedSettings = [];
    
    for (const { key, value } of envVars) {
      if (value) {
        await prisma.dashboardSettings.create({
          data: {
            key,
            value: value
          }
        });
        populatedSettings.push(key);
      }
    }

    console.log('QUICK SCHEMA FIX: Completed successfully!');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Dashboard settings schema fixed and populated from environment variables',
      populatedSettings
    });
  } catch (error) {
    console.error('QUICK SCHEMA FIX failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace'
    }, { status: 500 });
  }
}