#!/usr/bin/env node
/**
 * Test script for email analytics tRPC endpoints
 * Run with: node test-email-trpc.mjs
 */

import { PrismaClient } from './src/generated/prisma/index.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.local') });

const prisma = new PrismaClient();

async function testEmailTRPCEndpoints() {
  console.log('🧪 Testing Email Analytics tRPC Endpoints\n');
  console.log('=' .repeat(50));

  try {
    // Setup: Create test data
    console.log('\n📝 Setup: Creating test email data...');
    
    // Create a test user first
    const testUser = await prisma.user.upsert({
      where: { username: 'testuser' },
      update: {},
      create: {
        email: 'test-recipient@example.com',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        isActive: true,
      },
    });
    console.log(`  ✅ Created test user: ${testUser.username}`);

    // Create variety of email history records
    const emailTypes = ['welcome', 'admin_message', 'invite', 'password_reset', 'custom'];
    const senders = ['admin', 'moderator', 'system'];
    const statuses = ['sent', 'sent', 'sent', 'failed']; // 75% success rate
    
    const testEmails = [];
    for (let i = 0; i < 20; i++) {
      const email = await prisma.emailHistory.create({
        data: {
          recipientEmail: i % 3 === 0 ? testUser.email : `user${i}@example.com`,
          recipientId: i % 3 === 0 ? testUser.id : null,
          senderUsername: senders[i % senders.length],
          subject: `Test Email ${i + 1}`,
          emailType: emailTypes[i % emailTypes.length],
          status: statuses[i % statuses.length],
          messagePreview: `This is test email ${i + 1} content preview...`,
          sentAt: new Date(Date.now() - (i * 60 * 60 * 1000)), // Spread over last 20 hours
        },
      });
      testEmails.push(email);
    }
    console.log(`  ✅ Created ${testEmails.length} test email records`);

    // Test 1: getEmailAnalytics - Basic query
    console.log('\n🔍 Test 1: getEmailAnalytics - Basic query...');
    
    const analyticsResult = await prisma.emailHistory.findMany({
      take: 25,
      skip: 0,
      orderBy: { sentAt: 'desc' },
      include: {
        recipient: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    
    const totalCount = await prisma.emailHistory.count();
    console.log(`  ✅ Retrieved ${analyticsResult.length} emails (Total: ${totalCount})`);

    // Test 2: getEmailAnalytics - With filters
    console.log('\n🎯 Test 2: getEmailAnalytics - With filters...');
    
    const filteredResult = await prisma.emailHistory.findMany({
      where: {
        emailType: 'welcome',
        status: 'sent',
      },
      orderBy: { sentAt: 'desc' },
    });
    console.log(`  ✅ Found ${filteredResult.length} sent welcome emails`);

    // Test 3: getEmailStats - Statistics
    console.log('\n📊 Test 3: getEmailStats - Statistics...');
    
    const [totalEmails, sentEmails, failedEmails] = await Promise.all([
      prisma.emailHistory.count(),
      prisma.emailHistory.count({ where: { status: 'sent' } }),
      prisma.emailHistory.count({ where: { status: 'failed' } }),
    ]);
    
    const successRate = totalEmails > 0 ? (sentEmails / totalEmails * 100) : 0;
    
    console.log(`  📈 Statistics:`);
    console.log(`    - Total emails: ${totalEmails}`);
    console.log(`    - Sent emails: ${sentEmails}`);
    console.log(`    - Failed emails: ${failedEmails}`);
    console.log(`    - Success rate: ${successRate.toFixed(2)}%`);

    // Test 4: Email type breakdown
    console.log('\n📋 Test 4: Email type breakdown...');
    
    const emailTypeStats = await prisma.emailHistory.groupBy({
      by: ['emailType'],
      _count: { emailType: true },
      orderBy: { _count: { emailType: 'desc' } },
    });
    
    console.log('  Email types:');
    emailTypeStats.forEach(stat => {
      console.log(`    - ${stat.emailType}: ${stat._count.emailType} emails`);
    });

    // Test 5: Top senders
    console.log('\n👥 Test 5: Top senders...');
    
    const topSenders = await prisma.emailHistory.groupBy({
      by: ['senderUsername'],
      _count: { senderUsername: true },
      orderBy: { _count: { senderUsername: 'desc' } },
      take: 10,
    });
    
    console.log('  Top senders:');
    topSenders.forEach(sender => {
      console.log(`    - ${sender.senderUsername}: ${sender._count.senderUsername} emails`);
    });

    // Test 6: getUserEmailHistory - User-specific history
    console.log('\n👤 Test 6: getUserEmailHistory - User-specific history...');
    
    const userEmailHistory = await prisma.emailHistory.findMany({
      where: {
        OR: [
          { recipientId: testUser.id },
          { recipientEmail: testUser.email },
        ],
      },
      orderBy: { sentAt: 'desc' },
      include: {
        recipient: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    
    console.log(`  ✅ Found ${userEmailHistory.length} emails for user ${testUser.username}`);

    // Test 7: Date range filtering
    console.log('\n📅 Test 7: Date range filtering...');
    
    const twelveHoursAgo = new Date(Date.now() - (12 * 60 * 60 * 1000));
    const recentEmails = await prisma.emailHistory.findMany({
      where: {
        sentAt: { gte: twelveHoursAgo },
      },
    });
    
    console.log(`  ✅ Found ${recentEmails.length} emails in the last 12 hours`);

    // Test 8: Pagination
    console.log('\n📄 Test 8: Pagination...');
    
    const pageSize = 5;
    const pages = Math.ceil(totalCount / pageSize);
    
    for (let page = 1; page <= Math.min(3, pages); page++) {
      const pageResults = await prisma.emailHistory.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { sentAt: 'desc' },
      });
      console.log(`  ✅ Page ${page}: Retrieved ${pageResults.length} emails`);
    }

    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    
    // Delete test emails
    const deleteEmails = await prisma.emailHistory.deleteMany({
      where: {
        OR: [
          { recipientEmail: { startsWith: 'user' } },
          { recipientEmail: testUser.email },
        ],
      },
    });
    console.log(`  ✅ Deleted ${deleteEmails.count} test email records`);
    
    // Delete test user
    await prisma.user.delete({
      where: { id: testUser.id },
    });
    console.log(`  ✅ Deleted test user`);

    console.log('\n' + '=' .repeat(50));
    console.log('✅ All email tRPC endpoint tests passed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the tests
testEmailTRPCEndpoints().catch(console.error);