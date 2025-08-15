import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('Starting database setup...');

    // Create all necessary tables in the correct order
    
    // 1. Create users table first (referenced by other tables)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" TEXT PRIMARY KEY,
        "authentik_id" TEXT UNIQUE,
        "name" TEXT,
        "email" TEXT UNIQUE,
        "username" TEXT UNIQUE,
        "image" TEXT,
        "email_verified" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 2. Create accounts table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "accounts" (
        "id" TEXT PRIMARY KEY,
        "user_id" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "provider_account_id" TEXT NOT NULL,
        "refresh_token" TEXT,
        "access_token" TEXT,
        "expires_at" INTEGER,
        "token_type" TEXT,
        "scope" TEXT,
        "id_token" TEXT,
        "session_state" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "accounts_provider_provider_account_id_key" UNIQUE ("provider", "provider_account_id")
      );
    `;

    // 3. Create sessions table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "sessions" (
        "id" TEXT PRIMARY KEY,
        "session_token" TEXT UNIQUE NOT NULL,
        "user_id" TEXT NOT NULL,
        "expires" TIMESTAMP(3) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `;

    // 4. Create verification tokens table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "verification_tokens" (
        "identifier" TEXT NOT NULL,
        "token" TEXT UNIQUE NOT NULL,
        "expires" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "verification_tokens_identifier_token_key" UNIQUE ("identifier", "token")
      );
    `;

    // 5. Create dashboard_settings table (the one that was failing)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "dashboard_settings" (
        "id" SERIAL PRIMARY KEY,
        "settings" JSONB NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 6. Create any other missing tables that might be needed
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id" TEXT PRIMARY KEY,
        "content" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "channel_id" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `;

    // Insert a default dashboard_settings record if none exists
    await prisma.$executeRaw`
      INSERT INTO "dashboard_settings" ("settings")
      SELECT '{}'
      WHERE NOT EXISTS (SELECT 1 FROM "dashboard_settings" WHERE "id" = 1);
    `;

    console.log('Database setup completed successfully');

    // Verify tables were created
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    return NextResponse.json({ 
      success: true, 
      message: 'Database setup completed successfully',
      tables
    });

  } catch (error) {
    console.error('Database setup failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace'
    }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  try {
    // Check current database state
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    const settingsExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'dashboard_settings'
      );
    `;

    return NextResponse.json({
      success: true,
      tables,
      settingsExists
    });

  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}