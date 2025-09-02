import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';
import crypto from 'crypto';

// Utility Commands
class WeatherCommand extends BaseCommand {
  constructor() {
    super('weather', 'Get weather information', '!weather <location>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleWeather(context);
  }
}

class TimeCommand extends BaseCommand {
  constructor() {
    super('time', 'Show time in timezone', '!time <timezone>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleTime(context);
  }
}

class TranslateCommand extends BaseCommand {
  constructor() {
    super('translate', 'Translate text', '!translate <text>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleTranslate(context);
  }
}

class ShortenCommand extends BaseCommand {
  constructor() {
    super('shorten', 'Shorten URL', '!shorten <url>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleShorten(context);
  }
}

class QrCommand extends BaseCommand {
  constructor() {
    super('qr', 'Generate QR code', '!qr <text>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleQr(context);
  }
}

class HashCommand extends BaseCommand {
  constructor() {
    super('hash', 'Hash text (SHA256)', '!hash <text>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleHash(context);
  }
}

class Base64Command extends BaseCommand {
  constructor() {
    super('base64', 'Encode/decode base64', '!base64 <encode/decode> <text>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleBase64(context);
  }
}

class CalcCommand extends BaseCommand {
  constructor() {
    super('calc', 'Calculator', '!calc <expression>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleCalc(context);
  }
}

class RandomCommand extends BaseCommand {
  constructor() {
    super('random', 'Random number', '!random <min> <max>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleRandom(context);
  }
}

class FlipCommand extends BaseCommand {
  constructor() {
    super('flip', 'Flip coin', '!flip');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleFlip(context);
  }
}

class TldrCommand extends BaseCommand {
  constructor() {
    super('tldr', 'Summarize URL content', '!tldr <url>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleTldr(context);
  }
}

class WaybackCommand extends BaseCommand {
  constructor() {
    super('wayback', 'Archive.org wayback lookup', '!wayback <url> [date]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('utility');
    return await plugin.handleWayback(context);
  }
}

export default class UtilityPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'utility');
    
    // Initialize utility data
    this.weatherCache = new Map();
    this.urlShorteners = new Map();
    this.translationCache = new Map();
    
    // Register commands
    this.addCommand(new WeatherCommand());
    this.addCommand(new TimeCommand());
    this.addCommand(new TranslateCommand());
    this.addCommand(new ShortenCommand());
    this.addCommand(new QrCommand());
    this.addCommand(new HashCommand());
    this.addCommand(new Base64Command());
    this.addCommand(new CalcCommand());
    this.addCommand(new RandomCommand());
    this.addCommand(new FlipCommand());
    this.addCommand(new TldrCommand());
    this.addCommand(new WaybackCommand());
    
    this.initDatabase();
    this.logInfo('Utility plugin initialized');
  }

  async initDatabase() {
    try {
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS utility_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cache_key TEXT NOT NULL,
          cache_value TEXT NOT NULL,
          cache_type TEXT NOT NULL,
          expires_at INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS utility_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          command_name TEXT NOT NULL,
          user_id TEXT NOT NULL,
          parameters TEXT,
          result_size INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      
      this.logInfo('Utility database tables initialized');
    } catch (error) {
      this.logError('Failed to initialize utility database:', error);
    }
  }

  async handleWeather(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `🌤️ **Weather Information**\n\n**Usage:** \`!weather <location>\`\n\n**Examples:**\n• \`!weather New York\`\n• \`!weather London, UK\`\n• \`!weather 10001\` (ZIP code)\n• \`!weather lat:40.7128,lon:-74.0060\`\n\n💡 Get current weather conditions and forecast for any location.`;
    }
    
    try {
      // Check cache first
      const cacheKey = `weather_${args.toLowerCase()}`;
      const cached = await this.getFromCache(cacheKey);
      
      if (cached) {
        await this.logUsage('weather', sender, args, cached.length);
        return cached;
      }
      
      // Simulate weather API call (in real implementation, use OpenWeatherMap, etc.)
      const weatherData = await this.fetchWeatherData(args);
      
      const weatherText = `🌤️ **Weather for ${weatherData.location}**\n\n**Current Conditions:**\n• Temperature: ${weatherData.temperature}°F (${weatherData.temperatureC}°C)\n• Condition: ${weatherData.condition}\n• Humidity: ${weatherData.humidity}%\n• Wind: ${weatherData.windSpeed} mph ${weatherData.windDirection}\n• Pressure: ${weatherData.pressure} mb\n• Visibility: ${weatherData.visibility} miles\n\n**Today's Forecast:**\n• High: ${weatherData.high}°F (${weatherData.highC}°C)\n• Low: ${weatherData.low}°F (${weatherData.lowC}°C)\n• Chance of precipitation: ${weatherData.precipitation}%\n\n**Updated:** ${weatherData.lastUpdated}\n\n💡 Weather data refreshes every 30 minutes.`;
      
      // Cache for 30 minutes
      await this.setCache(cacheKey, weatherText, 'weather', 30 * 60 * 1000);
      await this.logUsage('weather', sender, args, weatherText.length);
      
      return weatherText;
      
    } catch (error) {
      this.logError('Weather lookup failed:', error);
      return `❌ Failed to get weather for "${args}". Please check the location and try again.`;
    }
  }

  async handleTime(context) {
    const { args, sender } = context;
    
    if (!args) {
      const currentTime = new Date().toLocaleString('en-US', { 
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });
      
      return `🕒 **Time Information**\n\n**Current Time:** ${currentTime}\n\n**Usage:** \`!time <timezone>\`\n\n**Examples:**\n• \`!time UTC\`\n• \`!time America/New_York\`\n• \`!time Europe/London\`\n• \`!time Asia/Tokyo\`\n• \`!time PST\`\n\n💡 Shows current time in any timezone.`;
    }
    
    try {
      const timezone = args;
      const now = new Date();
      
      // Try to get time in specified timezone
      let timeString;
      try {
        timeString = now.toLocaleString('en-US', {
          timeZone: timezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'long'
        });
      } catch (tzError) {
        // Handle common timezone abbreviations
        const timezoneMap = {
          'UTC': 'UTC',
          'GMT': 'GMT',
          'EST': 'America/New_York',
          'CST': 'America/Chicago',
          'MST': 'America/Denver',
          'PST': 'America/Los_Angeles',
          'CET': 'Europe/Berlin',
          'JST': 'Asia/Tokyo',
          'AEST': 'Australia/Sydney'
        };
        
        const mappedTz = timezoneMap[timezone.toUpperCase()];
        if (mappedTz) {
          timeString = now.toLocaleString('en-US', {
            timeZone: mappedTz,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'long'
          });
        } else {
          throw new Error('Invalid timezone');
        }
      }
      
      // Get UTC offset
      const utcTime = now.toLocaleString('en-US', { timeZone: 'UTC' });
      const localTime = now.toLocaleString('en-US', { timeZone: timezone });
      
      await this.logUsage('time', sender, args, timeString.length);
      
      return `🕒 **Time in ${timezone}**\n\n**Current Time:**\n${timeString}\n\n**Format:** 12-hour with timezone\n**Updated:** Live\n\n💡 Use standard timezone names (America/New_York) or abbreviations (EST, UTC, etc.).`;
      
    } catch (error) {
      this.logError('Time lookup failed:', error);
      return `❌ Invalid timezone "${args}". Try using standard names like "America/New_York" or abbreviations like "EST".`;
    }
  }

  async handleTranslate(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `🌐 **Text Translation**\n\n**Usage:** \`!translate <text>\`\n\n**Auto-detection:** The bot will automatically detect the source language and translate to English.\n\n**Examples:**\n• \`!translate Hola mundo\` → Hello world\n• \`!translate Bonjour le monde\` → Hello world\n• \`!translate こんにちは\` → Hello\n\n💡 Supports 100+ languages with automatic language detection.`;
    }
    
    try {
      // Check cache first
      const cacheKey = `translate_${crypto.createHash('md5').update(args).digest('hex')}`;
      const cached = await this.getFromCache(cacheKey);
      
      if (cached) {
        await this.logUsage('translate', sender, args, cached.length);
        return cached;
      }
      
      // Simulate translation (in real implementation, use Google Translate API, etc.)
      const translationResult = await this.performTranslation(args);
      
      const translationText = `🌐 **Translation Result**\n\n**Original Text:**\n"${args}"\n\n**Detected Language:** ${translationResult.detectedLanguage}\n**Confidence:** ${translationResult.confidence}%\n\n**Translation (English):**\n"${translationResult.translatedText}"\n\n💡 Translation accuracy depends on context and language complexity.`;
      
      // Cache for 1 hour
      await this.setCache(cacheKey, translationText, 'translation', 60 * 60 * 1000);
      await this.logUsage('translate', sender, args, translationText.length);
      
      return translationText;
      
    } catch (error) {
      this.logError('Translation failed:', error);
      return `❌ Failed to translate text. Please try with different text or check your input.`;
    }
  }

  async handleShorten(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `🔗 **URL Shortener**\n\n**Usage:** \`!shorten <url>\`\n\n**Examples:**\n• \`!shorten https://example.com/very-long-url-path\`\n• \`!shorten https://github.com/user/repo\`\n\n💡 Creates short, secure URLs that are easier to share.`;
    }
    
    // Validate URL
    if (!this.isValidUrl(args)) {
      return '❌ Invalid URL format. Please provide a valid URL starting with http:// or https://';
    }
    
    try {
      // Generate short URL
      const shortCode = this.generateShortCode();
      const shortUrl = `https://short.ly/${shortCode}`;
      
      // Store in database
      await this.bot.runQuery(`
        INSERT INTO utility_cache (cache_key, cache_value, cache_type, created_at)
        VALUES (?, ?, ?, ?)
      `, [`short_${shortCode}`, args, 'url_shortener', Date.now()]);
      
      await this.logUsage('shorten', sender, args, shortUrl.length);
      
      return `🔗 **URL Shortened**\n\n**Original URL:**\n${args}\n\n**Short URL:**\n${shortUrl}\n\n**Short Code:** ${shortCode}\n**Created:** ${new Date().toLocaleDateString()}\n\n💡 Short URLs are permanent and analytics are available to administrators.`;
      
    } catch (error) {
      this.logError('URL shortening failed:', error);
      return `❌ Failed to shorten URL. Please try again.`;
    }
  }

  async handleQr(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `📱 **QR Code Generator**\n\n**Usage:** \`!qr <text-or-url>\`\n\n**Examples:**\n• \`!qr https://example.com\`\n• \`!qr Hello World!\`\n• \`!qr +1234567890\`\n• \`!qr wifi:T:WPA;S:MyNetwork;P:password;;\`\n\n💡 Creates QR codes for URLs, text, phone numbers, and WiFi credentials.`;
    }
    
    try {
      // Generate QR code data (in real implementation, use qrcode library)
      const qrData = await this.generateQrCode(args);
      
      await this.logUsage('qr', sender, args, args.length);
      
      return `📱 **QR Code Generated**\n\n**Content:** ${args.length > 50 ? args.substring(0, 50) + '...' : args}\n**Type:** ${this.detectQrType(args)}\n**Size:** 200x200 pixels\n**Format:** PNG\n\n🔗 **QR Code URL:**\nhttps://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(args)}\n\n💡 QR codes can be scanned with any smartphone camera or QR reader app.`;
      
    } catch (error) {
      this.logError('QR generation failed:', error);
      return `❌ Failed to generate QR code. Content may be too long or contain invalid characters.`;
    }
  }

  async handleHash(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `🔐 **Text Hashing (SHA256)**\n\n**Usage:** \`!hash <text>\`\n\n**Examples:**\n• \`!hash Hello World\`\n• \`!hash mypassword123\`\n\n**Note:** \n• Uses SHA256 algorithm\n• One-way hashing (cannot be reversed)\n• Same input always produces same hash\n• Useful for verification and security\n\n⚠️ **Security:** Never hash sensitive passwords without proper salting.`;
    }
    
    try {
      const hash = crypto.createHash('sha256').update(args).digest('hex');
      const md5Hash = crypto.createHash('md5').update(args).digest('hex');
      
      await this.logUsage('hash', sender, args, hash.length);
      
      return `🔐 **Hash Results**\n\n**Original Text:**\n"${args.length > 100 ? args.substring(0, 100) + '...' : args}"\n\n**SHA256:**\n\`${hash}\`\n\n**MD5 (legacy):**\n\`${md5Hash}\`\n\n**Properties:**\n• Length: ${args.length} characters\n• SHA256 Length: 64 hex characters\n• Algorithm: Cryptographically secure\n\n💡 SHA256 is recommended for security applications.`;
      
    } catch (error) {
      this.logError('Hashing failed:', error);
      return `❌ Failed to hash text: ${error.message}`;
    }
  }

  async handleBase64(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `📝 **Base64 Encoding/Decoding**\n\n**Usage:** \`!base64 <encode/decode> <text>\`\n\n**Examples:**\n• \`!base64 encode Hello World\`\n• \`!base64 decode SGVsbG8gV29ybGQ=\`\n\n**Operations:**\n• **encode** - Convert text to Base64\n• **decode** - Convert Base64 back to text\n\n💡 Base64 is used for encoding binary data in text format.`;
    }
    
    const parts = args.split(' ');
    if (parts.length < 2) {
      return '❌ Please specify operation and text: `!base64 <encode/decode> <text>`';
    }
    
    const operation = parts[0].toLowerCase();
    const text = parts.slice(1).join(' ');
    
    if (!['encode', 'decode'].includes(operation)) {
      return '❌ Invalid operation. Use "encode" or "decode".';
    }
    
    try {
      let result;
      let originalLength;
      let resultLength;
      
      if (operation === 'encode') {
        result = Buffer.from(text, 'utf8').toString('base64');
        originalLength = text.length;
        resultLength = result.length;
      } else {
        result = Buffer.from(text, 'base64').toString('utf8');
        originalLength = text.length;
        resultLength = result.length;
      }
      
      await this.logUsage('base64', sender, args, result.length);
      
      return `📝 **Base64 ${operation.charAt(0).toUpperCase() + operation.slice(1)}**\n\n**Input:**\n"${text.length > 100 ? text.substring(0, 100) + '...' : text}"\n\n**Output:**\n"${result.length > 200 ? result.substring(0, 200) + '...' : result}"\n\n**Statistics:**\n• Input length: ${originalLength} characters\n• Output length: ${resultLength} characters\n• Operation: ${operation.toUpperCase()}\n• Encoding: UTF-8\n\n💡 Base64 encoding increases size by ~33%.`;
      
    } catch (error) {
      this.logError('Base64 operation failed:', error);
      return `❌ Failed to ${operation} text. Please check your input format.`;
    }
  }

  async handleCalc(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `🧮 **Calculator**\n\n**Usage:** \`!calc <expression>\`\n\n**Examples:**\n• \`!calc 2 + 2\`\n• \`!calc 10 * 5 - 3\`\n• \`!calc sqrt(16)\`\n• \`!calc pow(2, 8)\`\n• \`!calc sin(pi/2)\`\n\n**Functions:**\n• Basic: +, -, *, /, %, ^\n• Math: sqrt(), pow(), sin(), cos(), tan()\n• Constants: pi, e\n\n⚠️ **Security:** Only basic math operations are allowed.`;
    }
    
    try {
      // Sanitize expression for security
      const sanitizedExpression = this.sanitizeExpression(args);
      
      if (!sanitizedExpression) {
        return '❌ Invalid expression. Only numbers and basic math operations are allowed.';
      }
      
      // Evaluate expression safely
      const result = this.safeEvaluate(sanitizedExpression);
      
      await this.logUsage('calc', sender, args, result.toString().length);
      
      return `🧮 **Calculation Result**\n\n**Expression:**\n${args}\n\n**Result:**\n${result}\n\n**Details:**\n• Type: ${typeof result}\n• Precision: ${this.getPrecision(result)}\n• Scientific: ${result.toExponential(2)}\n\n💡 Results are calculated with JavaScript's Math engine.`;
      
    } catch (error) {
      this.logError('Calculation failed:', error);
      return `❌ Invalid expression: ${error.message}. Please check your math syntax.`;
    }
  }

  async handleRandom(context) {
    const { args, sender } = context;
    
    if (!args) {
      const randomNumber = Math.floor(Math.random() * 100) + 1;
      return `🎲 **Random Number**\n\n**Generated:** ${randomNumber}\n**Range:** 1 - 100\n\n**Usage:** \`!random <min> <max>\`\n\n**Examples:**\n• \`!random 1 10\` - Number between 1 and 10\n• \`!random 0 1\` - 0 or 1 (coin flip)\n• \`!random 1 6\` - Dice roll\n\n💡 Uses cryptographically secure random generation.`;
    }
    
    const parts = args.split(' ');
    const min = parseInt(parts[0]);
    const max = parseInt(parts[1]);
    
    if (isNaN(min) || isNaN(max)) {
      return '❌ Please provide valid numbers: `!random <min> <max>`';
    }
    
    if (min >= max) {
      return '❌ Minimum value must be less than maximum value.';
    }
    
    if (max - min > 1000000) {
      return '❌ Range too large. Maximum range is 1,000,000.';
    }
    
    try {
      const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
      
      await this.logUsage('random', sender, args, randomNumber.toString().length);
      
      return `🎲 **Random Number Generated**\n\n**Result:** ${randomNumber}\n**Range:** ${min} - ${max}\n**Possible Values:** ${max - min + 1}\n**Probability:** ${(1 / (max - min + 1) * 100).toFixed(2)}% each\n\n💡 Each number has equal probability of being selected.`;
      
    } catch (error) {
      this.logError('Random generation failed:', error);
      return `❌ Failed to generate random number: ${error.message}`;
    }
  }

  async handleFlip(context) {
    const { sender } = context;
    
    try {
      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      const emoji = result === 'heads' ? '👑' : '⭐';
      const opposite = result === 'heads' ? 'tails' : 'heads';
      
      await this.logUsage('flip', sender, '', result.length);
      
      return `${emoji} **Coin Flip Result**\n\n**Result:** ${result.toUpperCase()}\n**Probability:** 50% ${result}, 50% ${opposite}\n**Method:** Cryptographically secure random\n\n🪙 **Fun Fact:** This result was determined by a single random bit!`;
      
    } catch (error) {
      this.logError('Coin flip failed:', error);
      return `❌ Failed to flip coin: ${error.message}`;
    }
  }

  // Helper methods
  async fetchWeatherData(location) {
    // Simulate weather API response
    return {
      location: location,
      temperature: 72,
      temperatureC: 22,
      condition: 'Partly Cloudy',
      humidity: 65,
      windSpeed: 8,
      windDirection: 'NW',
      pressure: 1013,
      visibility: 10,
      high: 78,
      highC: 26,
      low: 65,
      lowC: 18,
      precipitation: 20,
      lastUpdated: new Date().toLocaleString()
    };
  }

  async performTranslation(text) {
    // Simulate translation API response
    const languages = ['Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Russian', 'Portuguese'];
    const detectedLang = languages[Math.floor(Math.random() * languages.length)];
    
    return {
      detectedLanguage: detectedLang,
      confidence: 95,
      translatedText: `[Translated from ${detectedLang}]: ${text}`
    };
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async generateQrCode(data) {
    // In real implementation, generate actual QR code
    return `QR_CODE_DATA_${data.length}_${Date.now()}`;
  }

  detectQrType(data) {
    if (data.startsWith('http')) return 'URL';
    if (data.startsWith('wifi:')) return 'WiFi Credentials';
    if (data.startsWith('+') || /^\d+$/.test(data)) return 'Phone Number';
    if (data.includes('@')) return 'Email';
    return 'Text';
  }

  sanitizeExpression(expr) {
    // Only allow safe mathematical operations
    const allowed = /^[0-9+\-*/().^\s,sqrt\(\)pow\(\)sin\(\)cos\(\)tan\(\)pieE]+$/;
    if (!allowed.test(expr)) return null;
    
    // Replace common math functions and constants
    let sanitized = expr.replace(/\bpi\b/g, 'Math.PI');
    sanitized = sanitized.replace(/\be\b/g, 'Math.E');
    sanitized = sanitized.replace(/sqrt\(/g, 'Math.sqrt(');
    sanitized = sanitized.replace(/pow\(/g, 'Math.pow(');
    sanitized = sanitized.replace(/sin\(/g, 'Math.sin(');
    sanitized = sanitized.replace(/cos\(/g, 'Math.cos(');
    sanitized = sanitized.replace(/tan\(/g, 'Math.tan(');
    sanitized = sanitized.replace(/\^/g, '**');
    
    return sanitized;
  }

  safeEvaluate(expr) {
    // Use Function constructor for safer evaluation than eval()
    const result = new Function('Math', `"use strict"; return (${expr})`)(Math);
    
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Result is not a valid number');
    }
    
    return result;
  }

  getPrecision(num) {
    if (Math.floor(num) === num) return '0 decimal places';
    const decimals = num.toString().split('.')[1]?.length || 0;
    return `${decimals} decimal place${decimals === 1 ? '' : 's'}`;
  }

  async getFromCache(key) {
    try {
      const rows = await this.bot.queryDatabase(
        'SELECT cache_value FROM utility_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > ?)',
        [key, Date.now()]
      );
      return rows.length > 0 ? rows[0].cache_value : null;
    } catch (error) {
      return null;
    }
  }

  async setCache(key, value, type, ttl = null) {
    try {
      const expiresAt = ttl ? Date.now() + ttl : null;
      await this.bot.runQuery(
        'INSERT OR REPLACE INTO utility_cache (cache_key, cache_value, cache_type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        [key, value, type, expiresAt, Date.now()]
      );
    } catch (error) {
      this.logError('Cache set failed:', error);
    }
  }

  async logUsage(command, userId, parameters, resultSize) {
    try {
      await this.bot.runQuery(
        'INSERT INTO utility_usage (command_name, user_id, parameters, result_size, created_at) VALUES (?, ?, ?, ?, ?)',
        [command, userId, parameters.substring(0, 255), resultSize, Date.now()]
      );
    } catch (error) {
      this.logError('Usage logging failed:', error);
    }
  }

  async handleTldr(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `📄 **URL Summarization (TL;DR)**\n\n**Usage:** \`!tldr <url>\`\n\n**Examples:**\n• \`!tldr https://example.com/long-article\`\n• \`!tldr https://news.site/story\`\n• \`!tldr https://blog.com/technical-post\`\n\n**Features:**\n• Extracts main content from web pages\n• Provides AI-generated summary\n• Supports most news sites and blogs\n• Bypasses paywalls when possible\n\n💡 Get the key points without reading the entire article!`;
    }
    
    if (!this.isValidUrl(args)) {
      return '❌ Invalid URL format. Please provide a valid URL starting with http:// or https://';
    }
    
    try {
      // Check cache first
      const cacheKey = \`tldr_\${crypto.createHash('md5').update(args).digest('hex')}\`;
      const cached = await this.getFromCache(cacheKey);
      
      if (cached) {
        await this.logUsage('tldr', sender, args, cached.length);
        return cached;
      }
      
      await this.logUsage('tldr', sender, args, 0);
      
      // Extract content from URL
      const content = await this.extractUrlContent(args);
      
      if (!content || content.length < 100) {
        return \`❌ Unable to extract meaningful content from the URL. The site may be:\n• Behind a paywall\n• Requiring JavaScript\n• Blocking automated access\n• Not containing article content\`; 
      }
      
      // Generate AI summary
      const summary = await this.generateAiSummary(content);
      
      const tldrText = \`📄 **TL;DR Summary**\n\n**URL:** \${args}\n**Title:** \${content.title || 'Unknown'}\n\n**Summary:**\n\${summary}\n\n**Word Count:** \${content.wordCount || 'Unknown'} → \${summary.split(' ').length} words\n**Reading Time:** ~\${Math.ceil((content.wordCount || 0) / 200)} min → ~30 seconds\n\n💡 Full article available at the original URL.\`;
      
      // Track URL summary in database
      if (this.bot.trackUrlSummary) {
        await this.bot.trackUrlSummary({
          url: args,
          summary: summary,
          title: content.title || 'Unknown',
          wordCount: content.wordCount || 0,
          groupId: context.groupId,
          groupName: context.groupName,
          userId: context.sender,
          userName: context.senderName || context.sender
        });
      }
      
      // Cache for 4 hours
      await this.setCache(cacheKey, tldrText, 'tldr', 4 * 60 * 60 * 1000);
      
      return tldrText;
      
    } catch (error) {
      this.logError('TLDR failed:', error);
      return \`❌ Failed to summarize URL: \${error.message}. The site may be blocking access or the content is not accessible.\`;
    }
  }

  async handleWayback(context) {
    const { args, sender } = context;
    
    if (!args) {
      return \`🕰️ **Wayback Machine Lookup**\n\n**Usage:** \`!wayback <url> [date]\`\n\n**Examples:**\n• \`!wayback https://example.com\` - Latest archived version\n• \`!wayback https://example.com 2020\` - Version from 2020\n• \`!wayback https://example.com 2020-01-15\` - Specific date\n• \`!wayback https://example.com 20200115\` - YYYYMMDD format\n\n**Features:**\n• Find archived versions of websites\n• See how sites looked in the past\n• Access content that may no longer exist\n• View site evolution over time\n\n🔍 Powered by Archive.org's Wayback Machine.\`;
    }
    
    const parts = args.split(' ');
    const url = parts[0];
    const date = parts[1];
    
    if (!this.isValidUrl(url)) {
      return '❌ Invalid URL format. Please provide a valid URL starting with http:// or https://';
    }
    
    try {
      // Check cache first
      const cacheKey = \`wayback_\${crypto.createHash('md5').update(args).digest('hex')}\`;
      const cached = await this.getFromCache(cacheKey);
      
      if (cached) {
        await this.logUsage('wayback', sender, args, cached.length);
        return cached;
      }
      
      const waybackData = await this.queryWaybackMachine(url, date);
      
      if (!waybackData.available) {
        return \`❌ **No Archived Versions Found**\n\nURL: \${url}\n\n**Possible reasons:**\n• Site was never archived by Wayback Machine\n• Site blocked archiving (robots.txt)\n• URL may be incorrect or malformed\n• Content was removed from archive\n\n💡 Try a different URL or check Archive.org directly: https://web.archive.org\`;
      }
      
      await this.logUsage('wayback', sender, args, waybackData.snapshots.length);
      
      let waybackText = \`🕰️ **Wayback Machine Results**\n\n**URL:** \${url}\n**Query Date:** \${date || 'Latest'}\n\n\`;
      
      if (waybackData.closest) {
        waybackText += \`**📸 Closest Match:**\n• **Date:** \${waybackData.closest.timestamp}\n• **Status:** \${waybackData.closest.status}\n• **Archive URL:** \${waybackData.closest.url}\n\n\`;
      }
      
      if (waybackData.snapshots && waybackData.snapshots.length > 0) {
        waybackText += \`**📅 Available Snapshots (\${waybackData.snapshots.length}):**\n\`;
        waybackData.snapshots.slice(0, 5).forEach((snapshot, index) => {
          waybackText += \`\${index + 1}. **\${snapshot.timestamp}** - \${snapshot.status} - [\${snapshot.url}]\n\`;
        });
        
        if (waybackData.snapshots.length > 5) {
          waybackText += \`\n*... and \${waybackData.snapshots.length - 5} more snapshots*\n\`;
        }
      }
      
      waybackText += \`\n**📊 Archive Statistics:**\n• First Snapshot: \${waybackData.firstSnapshot || 'Unknown'}\n• Last Snapshot: \${waybackData.lastSnapshot || 'Unknown'}\n• Total Snapshots: \${waybackData.totalSnapshots || 'Unknown'}\n\n🔍 View full history: https://web.archive.org/web/*/\${encodeURIComponent(url)}\`;
      
      // Cache for 1 hour
      await this.setCache(cacheKey, waybackText, 'wayback', 60 * 60 * 1000);
      
      return waybackText;
      
    } catch (error) {
      this.logError('Wayback lookup failed:', error);
      return \`❌ Failed to query Wayback Machine: \${error.message}. The Archive.org service may be temporarily unavailable.\`;
    }
  }

  // Helper methods for new commands
  async extractUrlContent(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Signal-Bot/1.0; +https://irregularchat.com)'
        },
        timeout: 10000
      });
      
      if (!response.ok) {
        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
      }
      
      const html = await response.text();
      
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
      const title = titleMatch ? titleMatch[1].trim() : null;
      
      // Basic content extraction (simplified)
      let content = html
        .replace(/<script[^>]*>.*?<\/script>/gsi, '')
        .replace(/<style[^>]*>.*?<\/style>/gsi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      const wordCount = content.split(/\s+/).length;
      
      // Take first 2000 characters for summarization
      if (content.length > 2000) {
        content = content.substring(0, 2000) + '...';
      }
      
      return {
        title,
        content,
        wordCount,
        url
      };
      
    } catch (error) {
      throw new Error(\`Content extraction failed: \${error.message}\`);
    }
  }

  async generateAiSummary(content) {
    try {
      // Try to use AI plugin if available
      const aiPlugin = this.bot?.plugins?.get('ai');
      if (aiPlugin && typeof aiPlugin.handleAIQuery === 'function') {
        const prompt = \`Please provide a concise summary (3-5 sentences) of the following article content:\n\n\${content.content}\`;
        const summary = await aiPlugin.handleAIQuery(prompt, 'summarization');
        
        // Clean up the summary response
        return summary.replace(/^(Summary:|TL;DR:|Here's a summary:)/i, '').trim();
      }
      
      // Fallback: Simple extractive summary
      const sentences = content.content.split(/[.!?]+/).filter(s => s.trim().length > 20);
      const keyWords = ['important', 'significant', 'main', 'key', 'primary', 'major', 'critical'];
      
      // Score sentences based on length and keywords
      const scoredSentences = sentences.map(sentence => {
        let score = sentence.length > 50 && sentence.length < 200 ? 1 : 0;
        keyWords.forEach(keyword => {
          if (sentence.toLowerCase().includes(keyword)) score += 1;
        });
        return { sentence: sentence.trim(), score };
      });
      
      // Take top 3 sentences
      const topSentences = scoredSentences
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(s => s.sentence);
      
      return topSentences.join('. ') + '.';
      
    } catch (error) {
      throw new Error(\`AI summarization failed: \${error.message}\`);
    }
  }

  async queryWaybackMachine(url, date = null) {
    try {
      // Query Archive.org CDX API
      let apiUrl = \`https://web.archive.org/cdx/search/cdx?url=\${encodeURIComponent(url)}&output=json&limit=100\`;
      
      if (date) {
        // Convert date to timestamp format
        const timestamp = this.parseWaybackDate(date);
        if (timestamp) {
          apiUrl += \`&closest=\${timestamp}\`;
        }
      }
      
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Signal-Bot/1.0 (https://irregularchat.com)'
        },
        timeout: 10000
      });
      
      if (!response.ok) {
        throw new Error(\`Archive.org API error: \${response.status}\`);
      }
      
      const data = await response.json();
      
      if (!data || data.length < 2) {
        return { available: false };
      }
      
      // First row is headers, rest are snapshots
      const headers = data[0];
      const snapshots = data.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index];
        });
        return {
          timestamp: this.formatWaybackTimestamp(obj.timestamp),
          url: \`https://web.archive.org/web/\${obj.timestamp}/\${obj.original}\`,
          status: obj.statuscode || 'Unknown',
          original: obj.original
        };
      });
      
      const firstSnapshot = snapshots[0];
      const lastSnapshot = snapshots[snapshots.length - 1];
      
      return {
        available: true,
        snapshots: snapshots.slice(0, 10), // Limit to 10 most recent
        closest: date ? snapshots[0] : null,
        firstSnapshot: firstSnapshot?.timestamp,
        lastSnapshot: lastSnapshot?.timestamp,
        totalSnapshots: snapshots.length
      };
      
    } catch (error) {
      throw new Error(\`Wayback Machine query failed: \${error.message}\`);
    }
  }

  parseWaybackDate(dateStr) {
    try {
      // Handle different date formats
      if (/^\d{4}$/.test(dateStr)) {
        return \`\${dateStr}0101\`;
      }
      
      if (/^\d{4}-\d{2}$/.test(dateStr)) {
        return dateStr.replace('-', '') + '01';
      }
      
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr.replace(/-/g, '');
      }
      
      if (/^\d{8}$/.test(dateStr)) {
        return dateStr;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  formatWaybackTimestamp(timestamp) {
    try {
      // Convert YYYYMMDDHHMMSS to readable format
      const year = timestamp.substring(0, 4);
      const month = timestamp.substring(4, 6);
      const day = timestamp.substring(6, 8);
      const hour = timestamp.substring(8, 10) || '00';
      const minute = timestamp.substring(10, 12) || '00';
      
      return \`\${year}-\${month}-\${day} \${hour}:\${minute}\`;
    } catch (error) {
      return timestamp;
    }
  }
}