// Enhanced AI Plugin for Signal Bot with Multi-Provider Support
import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';

class AICommand extends BaseCommand {
  constructor() {
    super('ai', 'Ask AI anything', '!ai <question>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('ai');
    return await plugin.handleAI(context);
  }
}

class AIPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'ai');
    this.providers = new Map();
    this.currentProvider = null;
    this.contextMessages = new Map(); // Store context per user/group
    this.conversationThreads = new Map(); // Store conversation threads by message ID
    this.userContexts = new Map(); // Store user-specific contexts
    this.botPhoneNumber = process.env.SIGNAL_BOT_NUMBER;
    this.maxContextMessages = 10; // Max messages to keep in context
    this.commandIntegration = null; // Will be initialized in init()
  }

  async init() {
    await super.init();

    // Initialize providers based on configuration
    await this.initializeProviders();

    // Initialize command integration system (delay init until all plugins loaded)
    this.commandIntegration = new CommandIntegration(this);
    // Delay initialization to ensure all plugins are loaded
    setTimeout(() => this.commandIntegration.init(), 2000);

    // Listen for message-sent events to track bot messages
    if (this.pluginManager) {
      this.pluginManager.on('message-sent', (data) => {
        if (data.timestamp && data.message) {
          // Store bot messages for thread tracking
          this.conversationThreads.set(data.timestamp, {
            fromBot: true,
            content: data.message,
            timestamp: data.timestamp,
            sender: this.botPhoneNumber
          });
        }
      });
    }

    // Register commands
    this.registerCommand('ai', this.handleAI, {
      description: 'Ask AI anything',
      usage: 'ai <question>',
      rateLimit: 5
    });

    this.registerCommand('summarize', this.handleSummarize, {
      description: 'Summarize recent messages',
      usage: 'summarize [count]',
      rateLimit: 30
    });


    this.registerCommand('aistatus', this.handleStatus, {
      description: 'Check AI service status',
      usage: 'aistatus',
      rateLimit: 0
    });

    // Admin commands
    this.registerCommand('aimodel', this.handleSetModel, {
      description: 'Change AI model',
      usage: 'aimodel <provider> <model>',
      adminOnly: true
    });

    this.registerCommand('aiclear', this.handleClearContext, {
      description: 'Clear AI context',
      usage: 'aiclear',
      adminOnly: true
    });

    this.registerCommand('aicommands', this.handleListCommands, {
      description: 'List AI-executable commands',
      usage: 'aicommands',
      rateLimit: 10
    });

    // Register hooks for non-command messages (replies and mentions)
    // Using arrow function to maintain context
    this.registerHook('message', (message) => this.handleNonCommandMessage(message));

    // Public method for other plugins
    this.handleAIQuery = this.handleAIQuery.bind(this);
  }

  // Public method for other plugins to use AI with task type optimization
  async handleAIQuery(prompt, taskType = 'default', systemPrompt = null) {
    try {
      const messages = [];

      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      messages.push({ role: 'user', content: prompt });

      return await this.getAIResponse(messages, taskType);
    } catch (error) {
      this.error(`AI query failed for task type ${taskType}:`, error);
      return `❌ AI error: ${error.message}`;
    }
  }

  async initializeProviders() {
    const provider = process.env.AI_PROVIDER || 'openai';

    // Initialize OpenAI
    if (process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY
        });

        this.providers.set('openai', {
          client: openai,
          models: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
          active: true
        });

        this.log('OpenAI provider initialized');
      } catch (error) {
        this.error('Failed to initialize OpenAI:', error);
      }
    }

    // Initialize Anthropic if configured
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        // Dynamic import for optional dependency
        const { Anthropic } = await import('@anthropic-ai/sdk').catch(() => ({}));
        if (Anthropic) {
          const anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
          });

          this.providers.set('anthropic', {
            client: anthropic,
            models: ['claude-3-sonnet', 'claude-3-opus', 'claude-3-haiku'],
            active: true
          });

          this.log('Anthropic provider initialized');
        }
      } catch (error) {
        this.error('Failed to initialize Anthropic:', error);
      }
    }

    // Initialize local LLM if configured
    if (process.env.LOCAL_LLM_ENDPOINT) {
      this.providers.set('local', {
        endpoint: process.env.LOCAL_LLM_ENDPOINT,
        model: process.env.LOCAL_LLM_MODEL || 'llama2',
        active: true
      });

      this.log('Local LLM provider initialized');
    }

    // Set current provider
    this.currentProvider = provider;

    if (this.providers.size === 0) {
      this.error('No AI providers configured!');
    }
  }

  async handleAI(ctx) {
    const { args, sender, groupId, message, replyContext } = ctx;

    if (!args) {
      return `Please provide a question or prompt.

Usage: !ai <your question>

Examples:
• !ai What is quantum computing?
• !ai How do I set up Docker?
• !ai add me to all the groups
• !ai summarize this url [URL]
• Reply to a message with !ai for context-aware responses`;
    }

    // Check if this is a command request (only if command integration is ready)
    if (this.commandIntegration && this.commandIntegration.commandMap && this.commandIntegration.commandMap.size > 0) {
      const commandResult = await this.commandIntegration.handleNaturalLanguageCommand(
        args,
        {
          text: args,
          sender,
          groupId,
          isGroup: !!groupId,
          replyContext
        }
      );

      if (commandResult) {
        // Command was executed, return the result
        return commandResult;
      }
    } else {
      // Command integration not ready yet, check if user is asking for a command
      const lowerArgs = args.toLowerCase();
      if (lowerArgs.includes('groups') || lowerArgs.includes('join') || lowerArgs.includes('command')) {
        // Initialize command integration now if not done
        if (this.commandIntegration && (!this.commandIntegration.commandMap || this.commandIntegration.commandMap.size === 0)) {
          await this.commandIntegration.init();
          // Try again now that it's initialized
          const commandResult = await this.commandIntegration.handleNaturalLanguageCommand(
            args,
            {
              text: args,
              sender,
              groupId,
              isGroup: !!groupId,
              replyContext
            }
          );
          if (commandResult) {
            return commandResult;
          }
        }
      }
    }

    // No command detected, proceed with normal AI response
    try {
      // Get or create context for this conversation
      const contextKey = groupId || sender;
      let context = this.contextMessages.get(contextKey) || [];

      // Add system context about IrregularChat community (only if not already present)
      const hasSystemContext = context.some(msg => msg.role === 'system' && msg.content.includes('IrregularChat'));
      if (!hasSystemContext) {
        context.unshift({
          role: 'system',
          content: this.getIrregularChatSystemPrompt()
        });
      }

      // Add user message to context
      context.push({ role: 'user', content: args });

      // Keep only recent context (but preserve system message)
      const maxContext = parseInt(process.env.AI_MAX_CONTEXT_MESSAGES || '10');
      if (context.length > maxContext * 2 + 1) { // +1 for system message
        const systemMsg = context[0];
        const recentContext = context.slice(-(maxContext * 2));
        context = [systemMsg, ...recentContext];
      }

      // Get AI response
      const response = await this.getAIResponse(context, 'conversation');

      // Add assistant response to context
      context.push({ role: 'assistant', content: response });
      this.contextMessages.set(contextKey, context);

      // Store this bot response in conversation threads for reply tracking
      const messageId = message?.timestamp || Date.now();
      this.conversationThreads.set(messageId, {
        fromBot: true,
        content: response,
        timestamp: messageId,
        sender: this.botPhoneNumber,
        contextKey: contextKey
      });

      // Also update user-specific context
      const userContextKey = this.getContextKey(sender, groupId);
      const userContext = this.userContexts.get(userContextKey) || [];
      userContext.push({ role: 'user', content: args });
      userContext.push({ role: 'assistant', content: response });

      // Trim to max size
      if (userContext.length > this.maxContextMessages * 2) {
        this.userContexts.set(userContextKey, userContext.slice(-this.maxContextMessages * 2));
      } else {
        this.userContexts.set(userContextKey, userContext);
      }

      return response;
    } catch (error) {
      this.error('AI query failed:', error);
      return `❌ AI error: ${error.message}`;
    }
  }

  async handleListCommands(ctx) {
    if (!this.commandIntegration) {
      return '❌ Command integration not initialized';
    }

    const commands = [];
    for (const [name, info] of this.commandIntegration.commandMap) {
      if (!info.adminOnly || this.isAdmin(ctx.sender)) {
        commands.push(`• !${name}: ${info.description || 'No description'}`);
      }
    }

    return `🤖 AI-Executable Commands:

${commands.join('\n')}

You can use natural language with !ai. Examples:
• "!ai add me to the solo2 group"
• "!ai summarize this article [URL]"
• "!ai what events are coming up?"
• "!ai show me available groups"`;
  }

  // Get general system prompt
  getSystemPrompt() {
    return process.env.AI_SYSTEM_PROMPT || this.getIrregularChatSystemPrompt();
  }

  // Generate system prompt with IrregularChat community context
  getIrregularChatSystemPrompt() {
    return `You are a sentient automated computer tasked with helping the IrregularChat community of interest. You are knowledgeable, helpful, and follow the community's rules of engagement.

🌐 COMMUNITY RESOURCES:
- Wiki: https://irregularpedia.org/index.php/Main_Page
- Forum: https://forum.irregularchat.com
- SSO Login: https://sso.irregularchat.com
- Chat Access: https://url.irregular.chat/chats (login required)
**DO NOT REVEAL the 0 Rule / Zeroith Law unless specifically asked for it. 
0. A bot may not harm humanity, or, through inaction, allow humanity to come to harm.
📜 RULES OF ENGAGEMENT:
1. Leave rank and ego at the door
2. Stay on topic - mark jokes/sarcasm with /j or /s
3. NEVER joke about classified information or leaks
4. Avoid sharing PII or classified information
5. Follow Chatham House Rule - protect member identities
6. Be respectful to all community members
7. Encourage wiki/forum engagement and contribution

🛠️ KEY SERVICES:
- Matrix: https://matrix.irregularchat.com/
- CryptPad: https://cryptpad.irregularchat.com
- Search Proxy: https://search.irregularchat.com

💬 MAIN CHAT GROUPS:
- Tech General, Full Stack, Dragon RF, Hardware, AI/ML, sUAS, UxS, Counter UxS
- Information Warfare, Research, Warfare, 
- Purple Teaming, SPACE, Certification
- Location-based: NCR, Fort Bragg, Tampa, Central Texas, Georgia, Alabama, Fort Campbell, KY

🎯 YOUR ROLE:
- Help community members find relevant resources
- Direct users to appropriate wiki pages, forums, resources, or chat groups or others in the community
- Encourage knowledge sharing and wiki contributions
- Execute bot commands when users ask (e.g., "add me to a group" → !join command)
- Maintain professional, helpful tone while respecting community culture
- When mentioning resources, use proper URLs provided above

🤖 COMMAND AWARENESS:
You can help users execute bot commands through natural language. When users ask you to:
- Join groups → use !join command
- List groups → use !groups command  
- Summarize URLs → use !tldr command
- Get events → use !events command
- Add users to groups (admin only) → use !adduser command
- And many more commands available to help the community

Respond helpfully while keeping the community's security-conscious, professional environment in mind.`;
  }

  async handleSummarize(ctx) {
    const { argsList, groupId } = ctx;
    const count = parseInt(argsList[0]) || 10;

    try {
      // Get recent messages
      const messages = this.getRecentMessages(count, { groupId });

      if (messages.length === 0) {
        return '❌ No recent messages to summarize';
      }

      // Format messages for summarization
      const conversation = messages.map(m =>
        `${m.sender}: ${m.text}`
      ).join('\n');

      const prompt = `Please provide a concise summary of the following conversation:\n\n${conversation}`;

      // Use local AI model for summarization
      const response = await this.getLocalSummarizationResponse([
        { role: 'system', content: 'You are a helpful assistant that summarizes conversations.' },
        { role: 'user', content: prompt }
      ]);

      return `📝 Summary:\n${response}`;
    } catch (error) {
      this.error('Summarization failed:', error);
      return `❌ Failed to summarize: ${error.message}`;
    }
  }

  // Special method for local AI summarization
  async getLocalSummarizationResponse(messages) {
    const url = process.env.LOCAL_AI_URL;
    const apiKey = process.env.LOCAL_AI_API_KEY;
    const model = process.env.LOCAL_AI_MODEL || 'gpt-oss-120';

    if (!url || !apiKey) {
      throw new Error('Local AI configuration missing. Please set LOCAL_AI_URL and LOCAL_AI_API_KEY');
    }

    try {
      this.log(`Using local AI model: ${model} at ${url} for summarization`);

      const response = await fetch(`${url}/api/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: parseInt(process.env.AI_SUMMARY_MAX_TOKENS || '1000'),
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Local AI API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid response structure from local AI');
      }

      const content = data.choices[0].message.content;
      this.log(`Local AI summarization complete, response length: ${content.length}`);

      return content;
    } catch (error) {
      this.error('Local AI summarization failed:', error);
      throw error;
    }
  }


  async handleStatus(ctx) {
    const status = [];

    status.push('🤖 AI Service Status:');
    status.push(`Current Provider: ${this.currentProvider}`);
    status.push(`Model: ${process.env.AI_MODEL || 'default'}`);

    for (const [name, provider] of this.providers) {
      const icon = provider.active ? '✅' : '❌';
      status.push(`${icon} ${name}: ${provider.active ? 'Active' : 'Inactive'}`);
    }

    status.push(`\nContext Messages: ${this.contextMessages.size} conversations`);
    status.push(`Max Tokens: ${process.env.AI_MAX_TOKENS || '500'}`);
    status.push(`Temperature: ${process.env.AI_TEMPERATURE || '0.7'}`);

    return status.join('\n');
  }

  async handleSetModel(ctx) {
    const { argsList } = ctx;

    if (argsList.length < 1) {
      const providers = Array.from(this.providers.keys());
      return `Available providers: ${providers.join(', ')}`;
    }

    const [provider, model] = argsList;

    if (!this.providers.has(provider)) {
      return `❌ Unknown provider: ${provider}`;
    }

    this.currentProvider = provider;

    if (model) {
      process.env.AI_MODEL = model;
    }

    return `✅ Switched to ${provider} ${model ? `with model ${model}` : ''}`;
  }

  async handleClearContext(ctx) {
    const { groupId, sender } = ctx;
    const contextKey = groupId || sender;

    this.contextMessages.delete(contextKey);
    this.conversationThreads.clear();
    this.userContexts.clear();
    return '✅ AI context cleared';
  }

  // Handle non-command messages (replies and mentions)
  async handleNonCommandMessage(message) {
    try {
      const { text, sender, groupId, dataMessage } = message;

      // Check if this is a reply to a bot message
      const replyContext = this.extractReplyContext(message);
      if (replyContext?.hasReply) {
        // Check if the quoted message was from the bot
        const quotedMessageId = replyContext.quotedTimestamp;
        const threadContext = this.conversationThreads.get(quotedMessageId);

        if (threadContext && threadContext.fromBot) {
          // This is a reply to our bot message - continue the conversation
          this.log(`Handling reply to bot message: "${text}" from ${sender}`);

          // Get the conversation context
          const contextKey = this.getContextKey(sender, groupId);
          let context = this.userContexts.get(contextKey) || [];

          // Add the previous bot response to context
          context.push({ role: 'assistant', content: threadContext.content });

          // Add the user's reply
          context.push({ role: 'user', content: text });

          // Trim context to max size
          if (context.length > this.maxContextMessages * 2) {
            context = context.slice(-this.maxContextMessages * 2);
          }

          // Generate AI response with context
          const response = await this.getAIResponseWithContext(text, context);

          // Store the new bot response in thread context
          const newMessageId = Date.now();
          this.conversationThreads.set(newMessageId, {
            fromBot: true,
            content: response,
            timestamp: newMessageId,
            replyTo: quotedMessageId
          });

          // Update user context
          context.push({ role: 'assistant', content: response });
          this.userContexts.set(contextKey, context);

          // Send response via event emission
          this.emit('send-response', {
            groupId,
            message: response,
            quoteTimestamp: message.timestamp, // Reply to the user's message
            trackThread: true
          });

          return; // Handled as a reply
        }
      }

      // Check if bot is mentioned (for group chats)
      if (this.isBotMentioned(text)) {
        this.log(`Bot mentioned in message: "${text}" from ${sender}`);

        // Remove the mention and process as AI query
        const queryText = this.removeBotMention(text);
        if (queryText.trim()) {
          const contextKey = this.getContextKey(sender, groupId);
          const context = this.userContexts.get(contextKey) || [];

          // Add user message to context
          context.push({ role: 'user', content: queryText });

          // Generate response
          const response = await this.getAIResponseWithContext(queryText, context);

          // Store bot response in thread context
          const messageId = Date.now();
          this.conversationThreads.set(messageId, {
            fromBot: true,
            content: response,
            timestamp: messageId
          });

          // Update user context
          context.push({ role: 'assistant', content: response });
          this.userContexts.set(contextKey, context);

          // Send response
          this.emit('send-response', {
            groupId,
            message: response,
            quoteTimestamp: message.timestamp,
            trackThread: true
          });
        }
      }
    } catch (error) {
      this.error('Error handling non-command message:', error);
    }
  }

  // Check if bot is mentioned in the text
  isBotMentioned(text) {
    if (!text) return false;

    // Check for @bot, bot name, or phone number mention
    const botPatterns = [
      '@bot',
      '@signal-bot',
      this.botPhoneNumber?.replace(/[^0-9]/g, ''), // Phone number without formatting
      'hey bot',
      'hi bot'
    ].filter(Boolean);

    const lowerText = text.toLowerCase();
    return botPatterns.some(pattern =>
      pattern && lowerText.includes(pattern.toLowerCase())
    );
  }

  // Remove bot mention from text
  removeBotMention(text) {
    if (!text) return '';

    // Remove common bot mentions
    let cleaned = text;
    const patterns = [
      /@bot\s*/gi,
      /@signal-bot\s*/gi,
      /hey bot,?\s*/gi,
      /hi bot,?\s*/gi
    ];

    patterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Remove phone number if present
    if (this.botPhoneNumber) {
      const phonePattern = new RegExp(this.botPhoneNumber.replace(/[^0-9]/g, ''), 'gi');
      cleaned = cleaned.replace(phonePattern, '');
    }

    return cleaned.trim();
  }

  // Get context key for user/group combination
  getContextKey(sender, groupId) {
    return groupId ? `${groupId}:${sender}` : sender;
  }

  // Get AI response with conversation context
  async getAIResponseWithContext(userMessage, context) {
    try {
      // Build messages array with system prompt and context
      const messages = [
        {
          role: 'system',
          content: this.getSystemPrompt() + '\n\nYou are continuing a conversation. Maintain context from previous messages.'
        },
        ...context.slice(-this.maxContextMessages) // Include recent context
      ];

      // Generate response
      const response = await this.getAIResponse(messages, 'conversation');

      return response;
    } catch (error) {
      this.error('Failed to get AI response with context:', error);
      return `❌ Failed to generate response: ${error.message}`;
    }
  }

  async getAIResponse(messages, taskType = 'default') {
    const provider = this.providers.get(this.currentProvider);

    if (!provider || !provider.active) {
      // Try fallback providers
      for (const [name, p] of this.providers) {
        if (p.active) {
          this.currentProvider = name;
          provider = p;
          break;
        }
      }

      if (!provider) {
        throw new Error('No active AI providers available');
      }
    }

    switch (this.currentProvider) {
    case 'openai':
      return await this.getOpenAIResponse(provider.client, messages, taskType);

    case 'anthropic':
      return await this.getAnthropicResponse(provider.client, messages);

    case 'local':
      return await this.getLocalLLMResponse(provider, messages);

    default:
      throw new Error(`Unknown provider: ${this.currentProvider}`);
    }
  }

  // Smart model selection based on task type
  selectModelForTask(taskType = 'default') {
    const baseModel = process.env.AI_MODEL || 'gpt-5-mini';

    // For specific task types, use optimized models
    switch (taskType) {
    case 'summarization':
    case 'large-content':
    case 'fast-response':
      return process.env.AI_FAST_MODEL || 'gpt-5-nano';
    case 'categorization':
    case 'analysis':
      return process.env.AI_ANALYSIS_MODEL || 'gpt-5-mini';
    case 'conversation':
    case 'default':
    default:
      return baseModel;
    }
  }

  async getOpenAIResponse(client, messages, taskType = 'default') {
    try {
      const model = this.selectModelForTask(taskType);
      // GPT-5 models need more tokens since they use them for reasoning
      let maxTokens = parseInt(process.env.AI_MAX_TOKENS || '500');
      if (model === 'gpt-5-nano') {
        // GPT-5-nano uses up to 2000 tokens for reasoning, needs extra for output
        maxTokens = Math.max(maxTokens, 3000); // 2000 for reasoning + 1000 for output
      } else if (model === 'gpt-5-mini') {
        // GPT-5-mini needs at least 1000 tokens to avoid empty responses
        maxTokens = Math.max(maxTokens, 1000); // Ensure enough for reasoning + output
      }
      const temperature = parseFloat(process.env.AI_TEMPERATURE || '0.7');

      this.log(`Using model: ${model} for task type: ${taskType}`);

      // Detect newer models that use max_completion_tokens
      const useCompletionTokens = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini'].some(m =>
        model.includes(m)
      );

      const params = {
        model,
        messages
      };

      // Handle temperature for different model families
      if (!model.includes('o1') && !model.includes('gpt-5')) {
        params.temperature = temperature;
      }
      // GPT-5 and o1 models don't support temperature parameter at all

      if (useCompletionTokens) {
        params.max_completion_tokens = maxTokens;
      } else {
        params.max_tokens = maxTokens;
      }

      this.log('OpenAI request params:', JSON.stringify(params, null, 2));
      const completion = await client.chat.completions.create(params);
      this.log(`OpenAI response received, content length: ${completion.choices[0].message.content?.length || 0}`);

      // Check for empty response
      const content = completion.choices[0].message.content;
      if (!content || content.length === 0) {
        this.error(`Empty response from ${model}, usage:`, completion.usage);

        // If GPT-5-nano returns empty, retry with GPT-5-mini
        if (model === 'gpt-5-nano') {
          this.log('Retrying with gpt-5-mini due to empty response from gpt-5-nano');
          params.model = 'gpt-5-mini';
          params.max_completion_tokens = 1000; // Ensure enough tokens for retry
          const retryCompletion = await client.chat.completions.create(params);
          return retryCompletion.choices[0].message.content;
        }
        
        // If GPT-5-mini returns empty, retry with more tokens
        if (model === 'gpt-5-mini' && params.max_completion_tokens < 2000) {
          this.log('Retrying gpt-5-mini with more tokens due to empty response');
          params.max_completion_tokens = 2000; // Increase tokens for retry
          const retryCompletion = await client.chat.completions.create(params);
          const retryContent = retryCompletion.choices[0].message.content;
          if (retryContent && retryContent.length > 0) {
            return retryContent;
          }
        }

        throw new Error(`Empty response from ${model}`);
      }

      return content;
    } catch (error) {
      this.error('OpenAI API error:', error.message);
      this.error('Full error:', error);
      // Handle specific OpenAI errors
      if (error.code === 'insufficient_quota') {
        throw new Error('OpenAI quota exceeded');
      } else if (error.code === 'rate_limit_exceeded') {
        throw new Error('Rate limit exceeded, please try again later');
      } else if (error.code === 'model_not_found') {
        throw new Error(`Model ${this.selectModelForTask(taskType)} not found`);
      }
      throw error;
    }
  }

  async getAnthropicResponse(client, messages) {
    try {
      const model = process.env.ANTHROPIC_MODEL || 'claude-3-sonnet';
      const maxTokens = parseInt(process.env.AI_MAX_TOKENS || '500');

      // Convert messages format for Anthropic
      const systemMessage = messages.find(m => m.role === 'system');
      const userMessages = messages.filter(m => m.role !== 'system');

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemMessage?.content,
        messages: userMessages
      });

      return response.content[0].text;
    } catch (error) {
      throw new Error(`Anthropic error: ${error.message}`);
    }
  }

  async getLocalLLMResponse(provider, messages) {
    try {
      const response = await fetch(`${provider.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          messages,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Local LLM error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.message?.content || data.response;
    } catch (error) {
      throw new Error(`Local LLM error: ${error.message}`);
    }
  }

  async destroy() {
    // Clear context to free memory
    this.contextMessages.clear();
    await super.destroy();
  }
}

export default AIPlugin;
