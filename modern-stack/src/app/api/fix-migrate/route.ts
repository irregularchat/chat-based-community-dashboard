import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('FIX MIGRATION: Checking existing tables and fixing schema...');
    
    // First, create dashboard_settings table (this is what's failing in the config)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "dashboard_settings" (
        "id" SERIAL PRIMARY KEY,
        "settings" JSONB NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('Created dashboard_settings table');
    
    // Check if users table exists and what type id is
    const userTableInfo = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'id' AND table_schema = 'public';
    `;
    
    console.log('User table info:', userTableInfo);
    
    // Create other tables without foreign key constraints for now
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "community_bookmarks" (
        "id" SERIAL PRIMARY KEY,
        "user_id" TEXT,
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
        "author_id" TEXT,
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
        "created_by_id" TEXT,
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

    console.log('FIX MIGRATION: All essential tables created successfully!');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database tables created successfully without foreign key constraints!',
      userTableInfo
    });
  } catch (error) {
    console.error('FIX MIGRATION failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}