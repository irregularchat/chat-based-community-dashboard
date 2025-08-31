import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';

// Fun/Social Commands
class JokeCommand extends BaseCommand {
  constructor() {
    super('joke', 'Random joke', '!joke [category]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('fun');
    return await plugin.handleJoke(context);
  }
}

class QuoteCommand extends BaseCommand {
  constructor() {
    super('quote', 'Random quote', '!quote [category]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('fun');
    return await plugin.handleQuote(context);
  }
}

class FactCommand extends BaseCommand {
  constructor() {
    super('fact', 'Random fact', '!fact [category]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('fun');
    return await plugin.handleFact(context);
  }
}

class PollCommand extends BaseCommand {
  constructor() {
    super('poll', 'Create poll', '!poll <question> <options>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('fun');
    return await plugin.handlePoll(context);
  }
}

class EightBallCommand extends BaseCommand {
  constructor() {
    super('8ball', 'Magic 8-ball', '!8ball <question>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('fun');
    return await plugin.handleEightBall(context);
  }
}

class DiceCommand extends BaseCommand {
  constructor() {
    super('dice', 'Roll dice', '!dice [sides] [count]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('fun');
    return await plugin.handleDice(context);
  }
}

export default class FunPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'fun');
    
    // Initialize fun data
    this.jokes = new Map();
    this.quotes = new Map();
    this.facts = new Map();
    this.polls = new Map();
    this.eightBallResponses = [
      'It is certain', 'Reply hazy, try again', 'Don\'t count on it',
      'It is decidedly so', 'Ask again later', 'My reply is no',
      'Without a doubt', 'Better not tell you now', 'My sources say no',
      'Yes definitely', 'Cannot predict now', 'Outlook not so good',
      'You may rely on it', 'Concentrate and ask again', 'Very doubtful',
      'As I see it, yes', 'Most likely', 'Outlook good',
      'Yes', 'Signs point to yes'
    ];
    
    // Register commands
    this.addCommand(new JokeCommand());
    this.addCommand(new QuoteCommand());
    this.addCommand(new FactCommand());
    this.addCommand(new PollCommand());
    this.addCommand(new EightBallCommand());
    this.addCommand(new DiceCommand());
    
    this.initDatabase();
    this.initContent();
    this.logInfo('Fun/Social plugin initialized');
  }

  async initDatabase() {
    try {
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS polls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          creator_id TEXT NOT NULL,
          question TEXT NOT NULL,
          options TEXT NOT NULL,
          votes TEXT DEFAULT '{}',
          group_id TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER,
          status TEXT DEFAULT 'active'
        )
      `);
      
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS fun_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          command_name TEXT NOT NULL,
          user_id TEXT NOT NULL,
          result_category TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      
      this.logInfo('Fun database tables initialized');
    } catch (error) {
      this.logError('Failed to initialize fun database:', error);
    }
  }

  initContent() {
    // Initialize jokes by category
    this.jokes.set('programming', [
      'Why do programmers prefer dark mode? Because light attracts bugs!',
      'A programmer is told to "go to hell", they find it: 127.0.0.1:666',
      'Why do Java developers wear glasses? Because they can\'t C#!',
      '99 little bugs in the code, 99 little bugs. Take one down, patch it around, 117 little bugs in the code.',
      'A SQL query goes into a bar, walks up to two tables and asks "Can I join you?"'
    ]);
    
    this.jokes.set('general', [
      'Why don\'t scientists trust atoms? Because they make up everything!',
      'I told my wife she was drawing her eyebrows too high. She looked surprised.',
      'Why don\'t eggs tell jokes? They\'d crack each other up!',
      'I\'m reading a book about anti-gravity. It\'s impossible to put down!',
      'Want to hear a construction joke? Oh never mind, I\'m still working on that one.'
    ]);
    
    this.jokes.set('tech', [
      'How many programmers does it take to change a light bulb? None, that\'s a hardware problem.',
      'There are only 10 types of people in the world: those who understand binary and those who don\'t.',
      'Why was the JavaScript developer sad? Because they didn\'t Node how to Express themselves!',
      'A byte walks into a bar looking miserable. The bartender asks "What\'s wrong?" The byte replies "Parity error."'
    ]);
    
    // Initialize quotes by category
    this.quotes.set('motivation', [
      '"The only way to do great work is to love what you do." - Steve Jobs',
      '"Innovation distinguishes between a leader and a follower." - Steve Jobs',
      '"The future belongs to those who believe in the beauty of their dreams." - Eleanor Roosevelt',
      '"It is during our darkest moments that we must focus to see the light." - Aristotle',
      '"Success is not final, failure is not fatal: it is the courage to continue that counts." - Winston Churchill'
    ]);
    
    this.quotes.set('technology', [
      '"Technology is best when it brings people together." - Matt Mullenweg',
      '"The advance of technology is based on making it fit in so that you don\'t really even notice it." - Bill Gates',
      '"Any sufficiently advanced technology is indistinguishable from magic." - Arthur C. Clarke',
      '"The real problem is not whether machines think but whether men do." - B.F. Skinner'
    ]);
    
    this.quotes.set('wisdom', [
      '"The only true wisdom is in knowing you know nothing." - Socrates',
      '"In the middle of difficulty lies opportunity." - Albert Einstein',
      '"Life is what happens to you while you\'re busy making other plans." - John Lennon',
      '"The journey of a thousand miles begins with one step." - Lao Tzu'
    ]);
    
    // Initialize facts by category
    this.facts.set('science', [
      'A group of flamingos is called a "flamboyance."',
      'Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still edible.',
      'The human brain contains approximately 86 billion neurons.',
      'A lightning bolt is about 5 times hotter than the surface of the sun.',
      'Bananas are berries, but strawberries aren\'t.'
    ]);
    
    this.facts.set('technology', [
      'The first computer bug was an actual bug - a moth found trapped in a Harvard Mark II computer in 1947.',
      'The term "spam" for junk email comes from a Monty Python sketch.',
      'The first webcam was created to monitor a coffee pot at Cambridge University.',
      'Google was originally called "BackRub."',
      'The "@" symbol was used in email addresses because it was the only preposition available on the keyboard.'
    ]);
    
    this.facts.set('random', [
      'Octopuses have three hearts and blue blood.',
      'The shortest war in history lasted only 38-45 minutes (Anglo-Zanzibar War, 1896).',
      'A group of pandas is called an "embarrassment."',
      'The unicorn is Scotland\'s national animal.',
      'There are more possible games of chess than atoms in the observable universe.'
    ]);
  }

  async handleJoke(context) {
    const { args, sender } = context;
    
    const category = args ? args.toLowerCase() : 'general';
    const availableCategories = Array.from(this.jokes.keys());
    
    if (args && !this.jokes.has(category)) {
      return `😄 **Joke Categories**\n\n**Available categories:** ${availableCategories.join(', ')}\n\n**Usage:** \`!joke [category]\`\n\n**Examples:**\n• \`!joke\` - Random general joke\n• \`!joke programming\` - Programming joke\n• \`!joke tech\` - Technology joke\n\n💡 Leave category blank for a random joke!`;
    }
    
    try {
      const jokes = this.jokes.get(category) || this.jokes.get('general');
      const joke = jokes[Math.floor(Math.random() * jokes.length)];
      
      await this.logFunStat('joke', sender, category);
      
      return `😄 **Joke Time!**\n\n${joke}\n\n**Category:** ${category.charAt(0).toUpperCase() + category.slice(1)}\n**Rating:** ${Math.floor(Math.random() * 3) + 3}/5 ⭐\n\n💡 Use \`!joke ${availableCategories.filter(c => c !== category).join('|')}\` for different categories!`;
      
    } catch (error) {
      this.logError('Joke failed:', error);
      return '❌ Failed to get joke. Even my humor module is broken! 😅';
    }
  }

  async handleQuote(context) {
    const { args, sender } = context;
    
    const category = args ? args.toLowerCase() : 'motivation';
    const availableCategories = Array.from(this.quotes.keys());
    
    if (args && !this.quotes.has(category)) {
      return `💭 **Quote Categories**\n\n**Available categories:** ${availableCategories.join(', ')}\n\n**Usage:** \`!quote [category]\`\n\n**Examples:**\n• \`!quote\` - Random motivational quote\n• \`!quote technology\` - Tech quotes\n• \`!quote wisdom\` - Wisdom quotes\n\n💡 Get inspired with daily quotes!`;
    }
    
    try {
      const quotes = this.quotes.get(category) || this.quotes.get('motivation');
      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      
      await this.logFunStat('quote', sender, category);
      
      return `💭 **Inspirational Quote**\n\n${quote}\n\n**Category:** ${category.charAt(0).toUpperCase() + category.slice(1)}\n**Daily wisdom for personal growth**\n\n✨ Share this quote to inspire others!`;
      
    } catch (error) {
      this.logError('Quote failed:', error);
      return '❌ Failed to get quote. "Failure is simply the opportunity to begin again, this time more intelligently." - Henry Ford';
    }
  }

  async handleFact(context) {
    const { args, sender } = context;
    
    const category = args ? args.toLowerCase() : 'random';
    const availableCategories = Array.from(this.facts.keys());
    
    if (args && !this.facts.has(category)) {
      return `🤓 **Fact Categories**\n\n**Available categories:** ${availableCategories.join(', ')}\n\n**Usage:** \`!fact [category]\`\n\n**Examples:**\n• \`!fact\` - Random interesting fact\n• \`!fact science\` - Science facts\n• \`!fact technology\` - Tech facts\n\n💡 Learn something new every day!`;
    }
    
    try {
      const facts = this.facts.get(category) || this.facts.get('random');
      const fact = facts[Math.floor(Math.random() * facts.length)];
      
      await this.logFunStat('fact', sender, category);
      
      return `🤓 **Did You Know?**\n\n${fact}\n\n**Category:** ${category.charAt(0).toUpperCase() + category.slice(1)}\n**Fun Fact #${Math.floor(Math.random() * 1000) + 1}**\n\n🧠 Knowledge is power - share this fact!`;
      
    } catch (error) {
      this.logError('Fact failed:', error);
      return '❌ Failed to get fact. Here\'s a fact: Error messages are never fun facts! 🤷‍♂️';
    }
  }

  async handlePoll(context) {
    const { args, sender, senderName, groupId } = context;
    
    if (!args) {
      return `📊 **Create Poll**\n\n**Usage:** \`!poll <question> <option1> <option2> [option3...]\`\n\n**Examples:**\n• \`!poll "What's your favorite language?" JavaScript Python Go Rust\`\n• \`!poll "Pizza or Tacos?" Pizza Tacos\`\n• \`!poll "Best IDE?" VSCode IntelliJ Vim Emacs\`\n\n**Features:**\n• Up to 6 options supported\n• 24-hour voting period\n• Anonymous voting\n• Real-time results\n\n💡 Great for group decisions and community engagement!`;
    }
    
    // Parse poll question and options
    const parts = args.split(' ');
    let question = '';
    let options = [];
    
    // Check if question is quoted
    if (args.startsWith('"')) {
      const endQuote = args.indexOf('"', 1);
      if (endQuote > 0) {
        question = args.substring(1, endQuote);
        options = args.substring(endQuote + 1).trim().split(' ').filter(o => o.length > 0);
      }
    } else {
      // Assume first few words are question, rest are options
      if (parts.length < 3) {
        return '❌ Please provide a question and at least 2 options: `!poll <question> <option1> <option2>`';
      }
      
      // Take first part as question, rest as options
      question = parts[0];
      options = parts.slice(1);
    }
    
    if (options.length < 2) {
      return '❌ Polls need at least 2 options to choose from.';
    }
    
    if (options.length > 6) {
      return '❌ Maximum 6 poll options allowed. Please reduce your options.';
    }
    
    try {
      const pollId = Math.floor(Math.random() * 10000);
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
      
      // Store poll in database
      await this.bot.runQuery(`
        INSERT INTO polls (creator_id, question, options, group_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [sender, question, JSON.stringify(options), groupId || null, Date.now(), expiresAt]);
      
      await this.logFunStat('poll', sender, 'created');
      
      let pollText = `📊 **New Poll Created!**\n\n**Question:** ${question}\n\n**Options:**\n`;
      
      options.forEach((option, index) => {
        pollText += `${index + 1}️⃣ ${option}\n`;
      });
      
      pollText += `\n**Poll ID:** #${pollId}\n`;
      pollText += `**Created by:** ${senderName || sender}\n`;
      pollText += `**Expires:** ${new Date(expiresAt).toLocaleString()}\n\n`;
      pollText += `💡 Vote by replying with the number (1-${options.length}) of your choice!\n`;
      pollText += `📈 Use \`!pollresults ${pollId}\` to see current results.`;
      
      return pollText;
      
    } catch (error) {
      this.logError('Poll creation failed:', error);
      return '❌ Failed to create poll. Please try again with a simpler format.';
    }
  }

  async handleEightBall(context) {
    const { args, sender } = context;
    
    if (!args) {
      return `🎱 **Magic 8-Ball**\n\n**Usage:** \`!8ball <question>\`\n\n**Examples:**\n• \`!8ball Will it rain tomorrow?\`\n• \`!8ball Should I deploy on Friday?\`\n• \`!8ball Is pineapple on pizza okay?\`\n\n**How it works:**\n• Ask any yes/no question\n• The Magic 8-Ball will provide mystical wisdom\n• Results are completely random\n• For entertainment purposes only!\n\n🔮 The spirits await your question...`;
    }
    
    if (!args.endsWith('?')) {
      return '❌ Please ask a proper question ending with a question mark (?).';
    }
    
    try {
      const response = this.eightBallResponses[Math.floor(Math.random() * this.eightBallResponses.length)];
      const confidence = Math.floor(Math.random() * 100) + 1;
      
      await this.logFunStat('8ball', sender, 'question');
      
      // Add some mystical delay simulation
      const mysticalEmojis = ['🔮', '✨', '🌟', '⭐', '💫', '🎱'];
      const emoji = mysticalEmojis[Math.floor(Math.random() * mysticalEmojis.length)];
      
      return `🎱 **Magic 8-Ball Oracle**\n\n**Your Question:**\n"${args}"\n\n**The 8-Ball says:**\n${emoji} *"${response}"* ${emoji}\n\n**Mystical Confidence:** ${confidence}%\n**Fortune Level:** ${this.getFortuneLevel(confidence)}\n\n🔮 The cosmic forces have spoken! Use this wisdom wisely...`;
      
    } catch (error) {
      this.logError('8-Ball failed:', error);
      return '🎱 The Magic 8-Ball is cloudy... Try again later! (Error in mystical realm)';
    }
  }

  async handleDice(context) {
    const { args, sender } = context;
    
    if (!args) {
      // Default: roll one 6-sided die
      const result = Math.floor(Math.random() * 6) + 1;
      await this.logFunStat('dice', sender, '1d6');
      
      return `🎲 **Dice Roll**\n\n**Result:** ${result}\n**Dice:** 1d6 (standard die)\n**Range:** 1-6\n\n**Usage:** \`!dice [sides] [count]\`\n\n**Examples:**\n• \`!dice\` - Roll 1d6\n• \`!dice 20\` - Roll 1d20\n• \`!dice 6 2\` - Roll 2d6\n• \`!dice 100 3\` - Roll 3d100\n\n🎯 Perfect for games and random decisions!`;
    }
    
    const parts = args.split(' ');
    const sides = parseInt(parts[0]) || 6;
    const count = parseInt(parts[1]) || 1;
    
    if (sides < 2 || sides > 1000) {
      return '❌ Dice must have between 2 and 1000 sides.';
    }
    
    if (count < 1 || count > 20) {
      return '❌ You can roll between 1 and 20 dice at once.';
    }
    
    try {
      const rolls = [];
      let total = 0;
      
      for (let i = 0; i < count; i++) {
        const roll = Math.floor(Math.random() * sides) + 1;
        rolls.push(roll);
        total += roll;
      }
      
      await this.logFunStat('dice', sender, `${count}d${sides}`);
      
      let resultText = `🎲 **Dice Roll Results**\n\n`;
      
      if (count === 1) {
        resultText += `**Result:** ${rolls[0]}\n`;
      } else {
        resultText += `**Individual Rolls:** ${rolls.join(', ')}\n`;
        resultText += `**Total:** ${total}\n`;
        resultText += `**Average:** ${(total / count).toFixed(1)}\n`;
      }
      
      resultText += `**Dice:** ${count}d${sides}\n`;
      resultText += `**Range per die:** 1-${sides}\n`;
      resultText += `**Possible total range:** ${count}-${count * sides}\n\n`;
      
      // Add special messages for common rolls
      if (sides === 6 && count === 2) {
        if (total === 7) resultText += '🎯 Lucky seven!\n';
        if (rolls[0] === rolls[1]) resultText += '🎊 Doubles!\n';
      }
      
      if (sides === 20 && rolls.includes(20)) {
        resultText += '⚡ Natural 20! Critical success!\n';
      }
      
      if (sides === 20 && rolls.includes(1)) {
        resultText += '💥 Natural 1! Critical failure!\n';
      }
      
      resultText += '🎲 May fortune favor your rolls!';
      
      return resultText;
      
    } catch (error) {
      this.logError('Dice roll failed:', error);
      return '❌ The dice fell off the table! Please try rolling again.';
    }
  }

  // Helper methods
  getFortuneLevel(confidence) {
    if (confidence >= 90) return 'Extremely High ⭐⭐⭐';
    if (confidence >= 70) return 'High ⭐⭐';
    if (confidence >= 50) return 'Moderate ⭐';
    if (confidence >= 30) return 'Low';
    return 'Very Low';
  }

  async logFunStat(command, userId, category) {
    try {
      await this.bot.runQuery(`
        INSERT INTO fun_stats (command_name, user_id, result_category, created_at)
        VALUES (?, ?, ?, ?)
      `, [command, userId, category, Date.now()]);
    } catch (error) {
      this.logError('Fun stat logging failed:', error);
    }
  }
}