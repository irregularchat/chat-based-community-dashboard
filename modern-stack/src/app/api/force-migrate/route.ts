import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('FORCE MIGRATION: Creating database tables directly...');
    
    // Create the dashboard_settings table with correct schema and populate from env
    await prisma.$executeRaw`
      DROP TABLE IF EXISTS "dashboard_settings" CASCADE;
      CREATE TABLE "dashboard_settings" (
        "id" SERIAL PRIMARY KEY,
        "key" VARCHAR(255) UNIQUE NOT NULL,
        "value" JSONB NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Initialize with environment variables
    const envSettings = [
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

    for (const [key, value] of envSettings) {
      if (value) {
        await prisma.$executeRaw`
          INSERT INTO "dashboard_settings" ("key", "value") 
          VALUES (${key}, ${JSON.stringify(value)})
          ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
        `;
      }
    }
    
    // Create users table for NextAuth (using TEXT id for compatibility)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "username" VARCHAR(255) UNIQUE,
        "email" VARCHAR(255),
        "first_name" VARCHAR(255),
        "last_name" VARCHAR(255),
        "password" VARCHAR(255),
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "is_admin" BOOLEAN NOT NULL DEFAULT false,
        "is_moderator" BOOLEAN NOT NULL DEFAULT false,
        "date_joined" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "last_login" TIMESTAMP(3),
        "attributes" JSONB,
        "authentik_id" VARCHAR(255) UNIQUE,
        "matrix_user_id" VARCHAR(255),
        "phone_number" VARCHAR(20),
        "signal_uuid" VARCHAR(255),
        "notes" TEXT
      );
    `;

    // Create other essential tables (using TEXT for user_id references)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "community_bookmarks" (
        "id" SERIAL PRIMARY KEY,
        "user_id" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
        "title" VARCHAR(255) NOT NULL,
        "url" VARCHAR(500) NOT NULL,
        "description" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "dashboard_announcements" (
        "id" SERIAL PRIMARY KEY,
        "title" VARCHAR(255) NOT NULL,
        "content" TEXT NOT NULL,
        "author_id" TEXT REFERENCES "users"("id"),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "is_active" BOOLEAN NOT NULL DEFAULT true
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "user_invitations" (
        "id" SERIAL PRIMARY KEY,
        "email" VARCHAR(255) NOT NULL,
        "token" VARCHAR(255) UNIQUE NOT NULL,
        "created_by_id" TEXT REFERENCES "users"("id"),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expires_at" TIMESTAMP(3) NOT NULL,
        "used_at" TIMESTAMP(3),
        "is_active" BOOLEAN NOT NULL DEFAULT true
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "admin_events" (
        "id" SERIAL PRIMARY KEY,
        "event_type" VARCHAR(100) NOT NULL,
        "username" VARCHAR(255) NOT NULL,
        "details" TEXT,
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('FORCE MIGRATION: All essential tables created successfully!');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database tables created successfully via raw SQL!' 
    });
  } catch (error) {
    console.error('FORCE MIGRATION failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}