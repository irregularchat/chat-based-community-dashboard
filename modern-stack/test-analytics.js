#!/usr/bin/env node

// Test script to verify analytics tracking is working
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('./src/generated/prisma');

const prisma = new PrismaClient();

async function testAnalytics() {
  console.log('🧪 Testing Analytics Tracking Implementation\n');
  
  try {
    // Test 1: Check bot command usage
    console.log('📊 Bot Command Usage (Last 10):');
    const commandUsage = await prisma.botCommandUsage.findMany({
      take: 10,
      orderBy: { timestamp: 'desc' },
      select: {
        command: true,
        groupName: true,
        userName: true,
        success: true,
        responseTime: true,
        timestamp: true
      }
    });
    
    if (commandUsage.length > 0) {
      commandUsage.forEach(cmd => {
        console.log(`  - !${cmd.command} by ${cmd.userName || 'Unknown'} in ${cmd.groupName || 'DM'} (${cmd.success ? '✅' : '❌'}) - ${cmd.responseTime}ms`);
      });
    } else {
      console.log('  No command usage recorded yet');
    }
    
    // Test 2: Check news links
    console.log('\n📰 News Links Tracked (Last 5):');
    const newsLinks = await prisma.newsLink.findMany({
      take: 5,
      orderBy: { firstPostedAt: 'desc' },
      select: {
        url: true,
        title: true,
        domain: true,
        groupName: true,
        postedByName: true,
        postCount: true,
        reactionCount: true,
        thumbsUp: true,
        thumbsDown: true,
        forumLink: true,
        forumUrl: true,
        summary: true
      }
    });
    
    if (newsLinks.length > 0) {
      newsLinks.forEach(link => {
        console.log(`  - ${link.title || link.domain}`);
        console.log(`    URL: ${link.url}`);
        console.log(`    Posted by: ${link.postedByName} in ${link.groupName || 'DM'}`);
        console.log(`    Stats: ${link.postCount} posts, ${link.reactionCount} reactions (👍 ${link.thumbsUp} 👎 ${link.thumbsDown})`);
        const forumUrl = link.forumUrl || link.forumLink;
        if (forumUrl) console.log(`    Forum: ${forumUrl}`);
      });
    } else {
      console.log('  No news links tracked yet');
    }
    
    // Test 3: Check URL summaries
    console.log('\n📄 URL Summaries (Last 5):');
    const urlSummaries = await prisma.urlSummary.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        url: true,
        groupName: true,
        requestedByName: true,
        summary: true,
        processingTime: true,
        createdAt: true
      }
    });
    
    if (urlSummaries.length > 0) {
      urlSummaries.forEach(summary => {
        const preview = summary.summary ? summary.summary.substring(0, 100) + (summary.summary.length > 100 ? '...' : '') : 'No summary';
        console.log(`  - ${summary.url}`);
        console.log(`    Summary: ${preview}`);
        console.log(`    By: ${summary.requestedByName || 'Unknown'} in ${summary.groupName || 'DM'}`);
        console.log(`    Processing Time: ${summary.processingTime}ms`);
      });
    } else {
      console.log('  No URL summaries tracked yet');
    }
    
    // Test 4: Check bot message reactions
    console.log('\n👍👎 Bot Message Reactions (Last 10):');
    const reactions = await prisma.botMessageReaction.findMany({
      take: 10,
      orderBy: { timestamp: 'desc' },
      select: {
        reaction: true,
        isPositive: true,
        command: true,
        reactorName: true,
        groupName: true,
        timestamp: true
      }
    });
    
    if (reactions.length > 0) {
      reactions.forEach(reaction => {
        const sentiment = reaction.isPositive ? '✅' : '❌';
        console.log(`  - ${reaction.reaction} ${sentiment} on !${reaction.command || 'unknown'} by ${reaction.reactorName || 'Unknown'} in ${reaction.groupName || 'DM'}`);
      });
    } else {
      console.log('  No bot message reactions tracked yet');
    }
    
    // Test 5: Check errors
    console.log('\n❌ Bot Errors (Last 5):');
    const errors = await prisma.botError.findMany({
      take: 5,
      orderBy: { timestamp: 'desc' },
      select: {
        errorType: true,
        errorMessage: true,
        command: true,
        groupName: true,
        userName: true,
        timestamp: true
      }
    });
    
    if (errors.length > 0) {
      errors.forEach(error => {
        console.log(`  - ${error.errorType}: ${error.errorMessage}`);
        if (error.command) console.log(`    Command: !${error.command}`);
        console.log(`    User: ${error.userName || 'Unknown'} in ${error.groupName || 'DM'}`);
      });
    } else {
      console.log('  No errors logged yet (good!)');
    }
    
    // Summary statistics
    console.log('\n📈 Summary Statistics:');
    const stats = {
      totalCommands: await prisma.botCommandUsage.count(),
      successfulCommands: await prisma.botCommandUsage.count({ where: { success: true } }),
      totalNewsLinks: await prisma.newsLink.count(),
      totalUrlSummaries: await prisma.urlSummary.count(),
      totalReactions: await prisma.botMessageReaction.count(),
      positiveReactions: await prisma.botMessageReaction.count({ where: { isPositive: true } }),
      totalErrors: await prisma.botError.count()
    };
    
    console.log(`  - Total Commands: ${stats.totalCommands} (${stats.successfulCommands} successful)`);
    console.log(`  - Success Rate: ${stats.totalCommands > 0 ? ((stats.successfulCommands / stats.totalCommands) * 100).toFixed(1) : 0}%`);
    console.log(`  - News Links Tracked: ${stats.totalNewsLinks}`);
    console.log(`  - URL Summaries: ${stats.totalUrlSummaries}`);
    console.log(`  - Bot Reactions: ${stats.totalReactions} (${stats.positiveReactions} positive)`);
    console.log(`  - Sentiment: ${stats.totalReactions > 0 ? ((stats.positiveReactions / stats.totalReactions) * 100).toFixed(1) : 0}% positive`);
    console.log(`  - Errors Logged: ${stats.totalErrors}`);
    
    console.log('\n✅ Analytics test complete!');
    
  } catch (error) {
    console.error('❌ Error testing analytics:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testAnalytics();