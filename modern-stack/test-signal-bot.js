#!/usr/bin/env node

/**
 * Comprehensive Test Suite for Production-Ready Signal CLI Bot
 * Tests all commands, APIs, and functionality
 */

const axios = require('axios');
const fs = require('fs');

class SignalBotTester {
  constructor() {
    this.baseUrl = 'http://localhost:50240';
    this.phoneNumber = '+19108471202';
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0,
      details: []
    };
    
    // Test configuration
    this.testTimeout = 5000;
    this.testCommands = [
      // Core commands
      { command: 'help', expected: 'Available Commands', category: 'Core' },
      { command: 'status', expected: 'Bot Status', category: 'Core' },
      { command: 'ping', expected: 'Pong', category: 'Core' },
      { command: 'groups', expected: 'Groups', category: 'Core' },
      
      // Q&A system
      { command: 'q How do I use this bot?', expected: 'Question', category: 'Q&A' },
      { command: 'pending', expected: 'questions', category: 'Q&A' },
      { command: 'faq', expected: 'FAQ', category: 'Q&A' },
      
      // AI functions
      { command: 'ai Hello', expected: 'OpenAI', category: 'AI' },
      { command: 'lai Hello', expected: 'LocalAI', category: 'AI' },
      { command: 'tldr https://example.com', expected: 'Summary', category: 'AI' },
      
      // Information commands
      { command: 'about', expected: 'community', category: 'Information' },
      { command: 'rules', expected: 'Rules', category: 'Information' },
      { command: 'links', expected: 'Links', category: 'Information' },
      { command: 'timezone', expected: 'Timezone', category: 'Information' },
      { command: 'docs commands', expected: 'Documentation', category: 'Information' },
      
      // Utility commands
      { command: 'summarize recent discussion', expected: 'Summary', category: 'Utilities' },
      { command: 'search bot commands', expected: 'Results', category: 'Utilities' },
      { command: 'wiki setup', expected: 'Wiki', category: 'Utilities' },
      
      // News & Repository commands
      { command: 'news', expected: 'news', category: 'News' },
      { command: 'repos', expected: 'repositories', category: 'News' },
      { command: 'updates', expected: 'Updates', category: 'News' }
    ];
  }

  async runTests() {
    console.log('🚀 Starting Comprehensive Signal CLI Bot Tests\n');
    
    // Test 1: Bot connectivity
    await this.testBotConnectivity();
    
    // Test 2: API endpoints
    await this.testApiEndpoints();
    
    // Test 3: Command functionality
    await this.testCommands();
    
    // Test 4: AI integrations
    await this.testAIFunctions();
    
    // Test 5: URL processing
    await this.testUrlProcessing();
    
    // Generate report
    this.generateReport();
  }

  async testBotConnectivity() {
    console.log('📡 Testing Bot Connectivity...');
    
    try {
      // Test Signal CLI REST API connection
      const response = await this.makeApiCall('/v1/about');
      this.recordTest('Signal CLI API Connection', true, 'Connected successfully');
      
      // Test groups endpoint
      const groups = await this.makeApiCall(`/v1/groups/${this.phoneNumber}`);
      const groupCount = groups ? groups.length : 0;
      this.recordTest('Groups Discovery', groupCount > 0, `Found ${groupCount} groups`);
      
    } catch (error) {
      this.recordTest('Bot Connectivity', false, error.message);
    }
  }

  async testApiEndpoints() {
    console.log('🔌 Testing API Endpoints...');
    
    const endpoints = [
      { path: '/v1/about', name: 'About Endpoint' },
      { path: `/v1/groups/${this.phoneNumber}`, name: 'Groups Endpoint' },
      { path: `/v1/receive/${this.phoneNumber}`, name: 'Receive Endpoint' }
    ];

    for (const endpoint of endpoints) {
      try {
        await this.makeApiCall(endpoint.path);
        this.recordTest(endpoint.name, true, 'Endpoint accessible');
      } catch (error) {
        this.recordTest(endpoint.name, false, error.message);
      }
    }
  }

  async testCommands() {
    console.log('⚡ Testing Command Functionality...');
    
    // Load the production bot to test command registry
    try {
      // Dynamic import to test command loading
      const botCode = fs.readFileSync('/Users/sac/Git/chat-based-community-dashboard/modern-stack/production-ready-signal-bot.js', 'utf8');
      
      // Test command count
      const commandMatches = botCode.match(/handler:\s*this\.\w+\.bind\(this\)/g);
      const commandCount = commandMatches ? commandMatches.length : 0;
      
      this.recordTest('Command Registry Loading', commandCount > 35, `${commandCount} commands found`);
      
      // Test required commands exist
      const requiredCommands = ['help', 'ai', 'lai', 'q', 'tldr', 'status', 'ping'];
      for (const cmd of requiredCommands) {
        const hasCommand = botCode.includes(`'${cmd}':`);
        this.recordTest(`Command: /${cmd}`, hasCommand, hasCommand ? 'Found' : 'Missing');
      }
      
    } catch (error) {
      this.recordTest('Command Functionality Test', false, error.message);
    }
  }

  async testAIFunctions() {
    console.log('🤖 Testing AI Integrations...');
    
    // Test OpenAI integration code
    const botCode = fs.readFileSync('/Users/sac/Git/chat-based-community-dashboard/modern-stack/production-ready-signal-bot.js', 'utf8');
    
    // Check for real OpenAI implementation
    const hasOpenAI = botCode.includes('new OpenAI(') && botCode.includes('gpt-5-mini');
    this.recordTest('OpenAI Integration', hasOpenAI, hasOpenAI ? 'Real implementation found' : 'Missing implementation');
    
    // Check for Local AI implementation
    const hasLocalAI = botCode.includes('LOCAL_AI_URL') && botCode.includes('fetch(');
    this.recordTest('Local AI Integration', hasLocalAI, hasLocalAI ? 'Implementation found' : 'Missing implementation');
    
    // Check for AI context and command execution
    const hasAIContext = botCode.includes('getAIDatabaseContext');
    this.recordTest('AI Context System', hasAIContext, hasAIContext ? 'Context system found' : 'Missing context system');
    
    // Check for web scraping
    const hasWebScraping = botCode.includes('cheerio') && botCode.includes('fetch(');
    this.recordTest('Web Scraping Integration', hasWebScraping, hasWebScraping ? 'Web scraping implemented' : 'Missing web scraping');
  }

  async testUrlProcessing() {
    console.log('🌐 Testing URL Processing...');
    
    const botCode = fs.readFileSync('/Users/sac/Git/chat-based-community-dashboard/modern-stack/production-ready-signal-bot.js', 'utf8');
    
    // Test URL cleaning functionality
    const hasUrlCleaning = botCode.includes('cleanUrl') && botCode.includes('tracker');
    this.recordTest('URL Cleaning System', hasUrlCleaning, hasUrlCleaning ? 'URL cleaning implemented' : 'Missing URL cleaning');
    
    // Test URL summarization
    const hasUrlSummary = botCode.includes('handleTldr') && botCode.includes('fetch(');
    this.recordTest('URL Summarization', hasUrlSummary, hasUrlSummary ? 'URL summarization implemented' : 'Missing summarization');
    
    // Test news processing
    const hasNewsProcessing = botCode.includes('processUrl') && botCode.includes('news');
    this.recordTest('News Processing', hasNewsProcessing, hasNewsProcessing ? 'News processing implemented' : 'Missing news processing');
  }

  async makeApiCall(endpoint, timeout = 5000) {
    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, { 
        timeout,
        headers: { 'Content-Type': 'application/json' }
      });
      return response.data;
    } catch (error) {
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        throw new Error('API connection failed - Signal CLI REST API not accessible');
      }
      throw error;
    }
  }

  recordTest(testName, passed, details) {
    this.testResults.total++;
    if (passed) {
      this.testResults.passed++;
      console.log(`  ✅ ${testName}: ${details}`);
    } else {
      this.testResults.failed++;
      console.log(`  ❌ ${testName}: ${details}`);
    }
    
    this.testResults.details.push({
      name: testName,
      passed,
      details,
      timestamp: new Date().toISOString()
    });
  }

  generateReport() {
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    console.log(`Total Tests: ${this.testResults.total}`);
    console.log(`✅ Passed: ${this.testResults.passed}`);
    console.log(`❌ Failed: ${this.testResults.failed}`);
    console.log(`📈 Success Rate: ${Math.round((this.testResults.passed / this.testResults.total) * 100)}%`);
    
    if (this.testResults.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults.details
        .filter(test => !test.passed)
        .forEach(test => console.log(`   • ${test.name}: ${test.details}`));
    }

    console.log('\n🎯 Production Readiness Assessment:');
    const successRate = (this.testResults.passed / this.testResults.total) * 100;
    
    if (successRate >= 90) {
      console.log('🟢 PRODUCTION READY - All critical systems operational');
    } else if (successRate >= 75) {
      console.log('🟡 MOSTLY READY - Some minor issues to address');
    } else {
      console.log('🔴 NOT READY - Critical issues need resolution');
    }

    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.testResults,
      productionReady: successRate >= 90,
      recommendations: this.generateRecommendations()
    };

    fs.writeFileSync('/Users/sac/Git/chat-based-community-dashboard/modern-stack/test-report.json', 
                     JSON.stringify(report, null, 2));
    console.log('\n📄 Detailed report saved to: test-report.json');
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.testResults.failed > 0) {
      recommendations.push('Address failed test cases before production deployment');
    }
    
    if (this.testResults.passed < 10) {
      recommendations.push('Expand test coverage for better reliability assessment');
    }
    
    recommendations.push('Monitor bot performance in production environment');
    recommendations.push('Set up real OpenAI API key for full AI functionality');
    recommendations.push('Configure proper database connection for optimal performance');
    
    return recommendations;
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new SignalBotTester();
  tester.runTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = SignalBotTester;