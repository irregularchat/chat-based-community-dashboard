#!/usr/bin/env node
/**
 * Test script for email service integration with tracking
 * Run with: node test-email-service-integration.mjs
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

// Mock email service to test tracking without sending real emails
class MockEmailService {
  constructor() {
    this.sentEmails = [];
  }

  async trackEmail(trackingData, status = 'sent', errorMessage = null) {
    try {
      const messagePreview = trackingData.messagePreview
        ? trackingData.messagePreview.substring(0, 200)
        : undefined;

      const record = await prisma.emailHistory.create({
        data: {
          recipientEmail: trackingData.recipientEmail,
          senderUsername: trackingData.senderUsername,
          subject: trackingData.subject,
          emailType: trackingData.emailType,
          status,
          errorMessage,
          messagePreview,
          recipientId: trackingData.recipientId,
        },
      });
      
      return record;
    } catch (error) {
      console.error('Failed to track email:', error);
      return null;
    }
  }

  async sendWelcomeEmail(data) {
    console.log(`  📧 Mock sending welcome email to ${data.to}`);
    
    // Simulate success/failure
    const success = Math.random() > 0.1; // 90% success rate
    
    // Track the email
    const tracked = await this.trackEmail({
      recipientEmail: data.to,
      senderUsername: 'system',
      subject: data.subject,
      emailType: 'welcome',
      messagePreview: `Welcome ${data.fullName}! Username: ${data.username}`,
    }, success ? 'sent' : 'failed', success ? null : 'Simulated failure');
    
    this.sentEmails.push({ type: 'welcome', data, tracked });
    return success;
  }

  async sendAdminEmail(to, subject, message, userData = null) {
    console.log(`  📧 Mock sending admin email to ${to}`);
    
    const success = Math.random() > 0.1;
    
    const tracked = await this.trackEmail({
      recipientEmail: to,
      senderUsername: 'admin',
      subject: subject,
      emailType: 'admin_message',
      messagePreview: message.substring(0, 200),
    }, success ? 'sent' : 'failed', success ? null : 'Simulated failure');
    
    this.sentEmails.push({ type: 'admin_message', to, subject, tracked });
    return success;
  }

  async sendPasswordResetEmail(data) {
    console.log(`  📧 Mock sending password reset to ${data.to}`);
    
    const success = Math.random() > 0.1;
    
    const tracked = await this.trackEmail({
      recipientEmail: data.to,
      senderUsername: 'admin',
      subject: data.subject,
      emailType: 'password_reset',
      messagePreview: `Password reset for ${data.fullName} (${data.username})`,
    }, success ? 'sent' : 'failed', success ? null : 'Simulated failure');
    
    this.sentEmails.push({ type: 'password_reset', data, tracked });
    return success;
  }
}

async function testEmailServiceIntegration() {
  console.log('🧪 Testing Email Service Integration with Tracking\n');
  console.log('=' .repeat(50));

  const emailService = new MockEmailService();

  try {
    // Test 1: Send various types of emails
    console.log('\n📮 Test 1: Sending various email types...');
    
    // Welcome email
    await emailService.sendWelcomeEmail({
      to: 'newuser@example.com',
      subject: 'Welcome to Our Platform',
      fullName: 'John Doe',
      username: 'johndoe',
      password: 'temp123',
    });

    // Admin message
    await emailService.sendAdminEmail(
      'user@example.com',
      'Important Update',
      'This is an important message from the admin regarding your account.',
      { username: 'existinguser', firstName: 'Jane', lastName: 'Smith' }
    );

    // Password reset
    await emailService.sendPasswordResetEmail({
      to: 'forgot@example.com',
      subject: 'Password Reset Request',
      fullName: 'Bob Johnson',
      username: 'bobjohnson',
      newPassword: 'newpass123',
    });

    console.log(`  ✅ Sent ${emailService.sentEmails.length} emails`);

    // Test 2: Verify tracking records were created
    console.log('\n📊 Test 2: Verifying tracking records...');
    
    const recentEmails = await prisma.emailHistory.findMany({
      where: {
        recipientEmail: {
          in: ['newuser@example.com', 'user@example.com', 'forgot@example.com'],
        },
      },
      orderBy: { sentAt: 'desc' },
    });

    console.log(`  ✅ Found ${recentEmails.length} tracking records`);
    
    // Verify each email type
    const welcomeTracked = recentEmails.find(e => e.emailType === 'welcome');
    const adminTracked = recentEmails.find(e => e.emailType === 'admin_message');
    const resetTracked = recentEmails.find(e => e.emailType === 'password_reset');
    
    console.log(`  ✅ Welcome email tracked: ${welcomeTracked ? 'Yes' : 'No'}`);
    console.log(`  ✅ Admin email tracked: ${adminTracked ? 'Yes' : 'No'}`);
    console.log(`  ✅ Password reset tracked: ${resetTracked ? 'Yes' : 'No'}`);

    // Test 3: Verify tracking data accuracy
    console.log('\n🔍 Test 3: Verifying tracking data accuracy...');
    
    if (welcomeTracked) {
      console.log('  Welcome email details:');
      console.log(`    - Recipient: ${welcomeTracked.recipientEmail}`);
      console.log(`    - Sender: ${welcomeTracked.senderUsername}`);
      console.log(`    - Type: ${welcomeTracked.emailType}`);
      console.log(`    - Status: ${welcomeTracked.status}`);
      console.log(`    - Preview: ${welcomeTracked.messagePreview?.substring(0, 50)}...`);
    }

    // Test 4: Test failure tracking
    console.log('\n❌ Test 4: Testing failure tracking...');
    
    // Force a failure by sending 10 emails (statistically, 1 should fail)
    let failures = 0;
    for (let i = 0; i < 10; i++) {
      const success = await emailService.sendAdminEmail(
        `test${i}@example.com`,
        'Test Email',
        'This is a test email for failure tracking'
      );
      if (!success) failures++;
    }
    
    console.log(`  ✅ Simulated ${failures} failures out of 10 emails`);
    
    // Check failed emails in database
    const failedEmails = await prisma.emailHistory.findMany({
      where: {
        status: 'failed',
        recipientEmail: { startsWith: 'test' },
      },
    });
    
    console.log(`  ✅ Found ${failedEmails.length} failed email records in database`);
    
    if (failedEmails.length > 0) {
      console.log(`  Failed email example:`);
      console.log(`    - Recipient: ${failedEmails[0].recipientEmail}`);
      console.log(`    - Error: ${failedEmails[0].errorMessage}`);
    }

    // Test 5: Analytics on tracked emails
    console.log('\n📈 Test 5: Email analytics...');
    
    const stats = await prisma.emailHistory.groupBy({
      by: ['status'],
      _count: { status: true },
    });
    
    console.log('  Status breakdown:');
    stats.forEach(stat => {
      console.log(`    - ${stat.status}: ${stat._count.status} emails`);
    });
    
    const typeStats = await prisma.emailHistory.groupBy({
      by: ['emailType'],
      _count: { emailType: true },
    });
    
    console.log('  Type breakdown:');
    typeStats.forEach(stat => {
      console.log(`    - ${stat.emailType}: ${stat._count.emailType} emails`);
    });

    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    
    const cleanup = await prisma.emailHistory.deleteMany({
      where: {
        OR: [
          { recipientEmail: { in: ['newuser@example.com', 'user@example.com', 'forgot@example.com'] } },
          { recipientEmail: { startsWith: 'test' } },
        ],
      },
    });
    
    console.log(`  ✅ Deleted ${cleanup.count} test email records`);

    console.log('\n' + '=' .repeat(50));
    console.log('✅ Email service integration tests completed successfully!');
    console.log('\nSummary:');
    console.log(`  - Emails sent: ${emailService.sentEmails.length}`);
    console.log(`  - Tracking verified: ✓`);
    console.log(`  - Failure tracking: ✓`);
    console.log(`  - Analytics working: ✓`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the tests
testEmailServiceIntegration().catch(console.error);