import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('FIXING DASHBOARD SETTINGS SCHEMA...');
    
    // First check what columns exist
    const currentStructure = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'dashboard_settings' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    console.log('Current dashboard_settings structure:', currentStructure);

    // Drop and recreate the table with the correct schema
    await prisma.$executeRaw`
      DROP TABLE IF EXISTS "dashboard_settings" CASCADE;
    `;

    await prisma.$executeRaw`
      CREATE TABLE "dashboard_settings" (
        "id" SERIAL PRIMARY KEY,
        "key" VARCHAR(255) UNIQUE NOT NULL,
        "value" JSONB NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Initialize with environment variables if they exist
    const envMappings = {
      'nextauth_url': process.env.NEXTAUTH_URL,
      'authentik_client_id': process.env.AUTHENTIK_CLIENT_ID,
      'authentik_client_secret': process.env.AUTHENTIK_CLIENT_SECRET,
      'authentik_issuer': process.env.AUTHENTIK_ISSUER,
      'authentik_base_url': process.env.AUTHENTIK_BASE_URL,
      'oidc_authorization_endpoint': process.env.OIDC_AUTHORIZATION_ENDPOINT,
      'oidc_token_endpoint': process.env.OIDC_TOKEN_ENDPOINT,
      'oidc_userinfo_endpoint': process.env.OIDC_USERINFO_ENDPOINT,
      'oidc_end_session_endpoint': process.env.OIDC_END_SESSION_ENDPOINT,
      'oidc_redirect_uri': process.env.OIDC_REDIRECT_URI,
    };

    const insertedSettings = [];
    for (const [key, value] of Object.entries(envMappings)) {
      if (value) {
        await prisma.$executeRaw`
          INSERT INTO "dashboard_settings" ("key", "value") 
          VALUES (${key}, ${JSON.stringify(value)}::jsonb)
          ON CONFLICT ("key") DO UPDATE SET "value" = ${JSON.stringify(value)}::jsonb
        `;
        insertedSettings.push(key);
      }
    }

    // Verify the new structure
    const newStructure = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'dashboard_settings' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;

    console.log('SCHEMA FIX COMPLETED!');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Dashboard settings schema fixed and populated from environment variables',
      oldStructure: currentStructure,
      newStructure: newStructure,
      populatedSettings: insertedSettings
    });
  } catch (error) {
    console.error('SCHEMA FIX failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace'
    }, { status: 500 });
  }
}