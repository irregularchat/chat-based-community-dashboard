import { Command, CommandContext, CommandResponse } from './base-command';
import { getRateLimiter, formatRateLimitMessage } from '../../utils/rate-limiter';

export class AiCommand extends Command {
  public name = 'ai';
  public description = 'Ask AI a question';
  public aliases = [];

  public async handle(context: CommandContext, args: string, previousAIResponse?: string): Promise<CommandResponse> {
    if (!this.openai) {
      return this.formatForSignal(
        '❌ AI Features Not Configured\n\n' +
        'To enable AI features, add your OpenAI API key to .env.local:\n\n' +
        'OPENAI_API_KEY=sk-proj-...\n\n' +
        'Then rebuild and restart the container.'
      );
    }

    if (!args || args.trim().length === 0) {
      return '❌ Please provide a question.\n\nUsage: !ai <your question>';
    }

    // CVE-2025-005: Rate limit AI requests (20 calls/hour)
    const rateLimiter = getRateLimiter();
    const limit = await rateLimiter.checkLimit(`ai:${context.sourceNumber}`, 20, 3600);

    if (!limit.allowed) {
      return formatRateLimitMessage('!ai', limit.resetIn);
    }

    try {
      // Build messages array - include previous context if this is a reply
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        {
          role: 'system',
          content: 'You are a helpful assistant in a Signal group chat. Keep responses concise and friendly.',
        },
      ];

      // If there's a previous AI response, include it for context
      if (previousAIResponse) {
        console.log(`🤖 AI reply continuation from ${context.sourceName}`);
        // Extract the actual response content (remove the "🤖 AI Response:\n\n" prefix)
        const previousContent = previousAIResponse.replace(/^🤖 AI Response:\n\n/, '').trim();
        messages.push({
          role: 'assistant',
          content: previousContent,
        });
      } else {
        console.log(`🤖 AI request from ${context.sourceName}: ${args}`);
      }

      messages.push({
        role: 'user',
        content: args,
      });

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 500,
        temperature: 0.7,
      });

      const answer = response.choices[0]?.message?.content || 'No response';

      return this.formatForSignal(`🤖 AI Response:\n\n${answer}`);
    } catch (error) {
      console.error('AI error:', error);
      return `❌ AI error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  public async handleAIReply(userMessage: string, previousAIResponse: string, context: CommandContext): Promise<CommandResponse> {
    // Only handle if the quoted message contains our AI response signature
    if (!previousAIResponse.includes('🤖 AI Response:')) {
      return null;
    }

    return this.handle(context, userMessage, previousAIResponse);
  }

  private formatForSignal(text: string): string {
    return text
      .replace(/^#{1,6}\s+(.+)$/gm, (_, content) => content.toUpperCase())
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
