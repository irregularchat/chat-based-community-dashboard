/**
 * Test script for email history tracking functionality
 * Run with: node test-email-tracking.js
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

async function testEmailTracking() {
  console.log('🧪 Testing Email History Tracking System\n');
  console.log('=' .repeat(50));

  try {
    // Test 1: Create test email history records
    console.log('\n📝 Test 1: Creating email history records...');
    
    const testEmails = [
      {
        recipientEmail: 'test1@example.com',
        senderUsername: 'admin',
        subject: 'Welcome to the platform',
        emailType: 'welcome',
        status: 'sent',
        messagePreview: 'Welcome to our community platform! Your username is...',
      },
      {
        recipientEmail: 'test2@example.com',
        senderUsername: 'admin',
        subject: 'Password Reset Request',
        emailType: 'password_reset',
        status: 'sent',
        messagePreview: 'Your password has been reset. Your new password is...',
      },
      {
        recipientEmail: 'test3@example.com',
        senderUsername: 'system',
        subject: 'Invitation to Join',
        emailType: 'invite',
        status: 'failed',
        errorMessage: 'SMTP connection failed',
        messagePreview: 'You have been invited to join our community...',
      },
    ];

    const createdEmails = [];
    for (const email of testEmails) {
      const created = await prisma.emailHistory.create({
        data: email,
      });
      createdEmails.push(created);
      console.log(`  ✅ Created ${email.emailType} email to ${email.recipientEmail}`);
    }

    // Test 2: Query email history
    console.log('\n🔍 Test 2: Querying email history...');
    
    const allEmails = await prisma.emailHistory.findMany({
      orderBy: { sentAt: 'desc' },
      take: 10,
    });
    console.log(`  ✅ Found ${allEmails.length} total emails`);

    // Test 3: Filter by email type
    console.log('\n🎯 Test 3: Filtering by email type...');
    
    const welcomeEmails = await prisma.emailHistory.findMany({
      where: { emailType: 'welcome' },
    });
    console.log(`  ✅ Found ${welcomeEmails.length} welcome emails`);

    // Test 4: Filter by status
    console.log('\n📊 Test 4: Filtering by status...');
    
    const failedEmails = await prisma.emailHistory.findMany({
      where: { status: 'failed' },
    });
    console.log(`  ✅ Found ${failedEmails.length} failed emails`);

    // Test 5: Get email statistics
    console.log('\n📈 Test 5: Getting email statistics...');
    
    const stats = await prisma.emailHistory.groupBy({
      by: ['emailType'],
      _count: { emailType: true },
    });
    
    console.log('  Email type breakdown:');
    stats.forEach(stat => {
      console.log(`    - ${stat.emailType}: ${stat._count.emailType} emails`);
    });

    // Test 6: Get success rate
    console.log('\n✨ Test 6: Calculating success rate...');
    
    const [totalCount, sentCount] = await Promise.all([
      prisma.emailHistory.count(),
      prisma.emailHistory.count({ where: { status: 'sent' } }),
    ]);
    
    const successRate = totalCount > 0 ? (sentCount / totalCount * 100).toFixed(2) : 0;
    console.log(`  ✅ Success rate: ${successRate}% (${sentCount}/${totalCount})`);

    // Test 7: Search by sender
    console.log('\n👤 Test 7: Searching by sender...');
    
    const adminEmails = await prisma.emailHistory.findMany({
      where: { senderUsername: 'admin' },
    });
    console.log(`  ✅ Found ${adminEmails.length} emails sent by admin`);

    // Test 8: Date range query
    console.log('\n📅 Test 8: Date range query...');
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const recentEmails = await prisma.emailHistory.findMany({
      where: {
        sentAt: {
          gte: yesterday,
          lte: today,
        },
      },
    });
    console.log(`  ✅ Found ${recentEmails.length} emails in the last 24 hours`);

    // Cleanup test data (optional)
    console.log('\n🧹 Cleaning up test data...');
    
    const deleteResult = await prisma.emailHistory.deleteMany({
      where: {
        recipientEmail: {
          in: ['test1@example.com', 'test2@example.com', 'test3@example.com'],
        },
      },
    });
    console.log(`  ✅ Deleted ${deleteResult.count} test email records`);

    console.log('\n' + '=' .repeat(50));
    console.log('✅ All email tracking tests passed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the tests
testEmailTracking().catch(console.error);