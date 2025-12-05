import { Command, CommandContext, CommandResponse } from './base-command';
import { isAdmin } from '../../utils/auth';
import { getRandomMeme, getMemeFilePath, memeFileExists } from '../../utils/meme-reactions';

export class HelpCommand extends Command {
  public name = 'help';
  public description = 'Show available commands';
  public aliases = [];

  public async handle(context: CommandContext, args: string): Promise<CommandResponse> {
    const isUserAdmin = await isAdmin(this.db, context.sourceUuid || context.sourceNumber);

    const lines = [
      '🤖 Signal Bot Commands (40+ available):',
      '',
      '🔧 Core:',
      '  !help, !ping, !ai, !lai, !summarize, !tldr, !zeroeth, !cleaner',
      '',
      '❓ Q&A System:',
      '  !ask, !q, !question - Ask a question',
      '  !questions - List recent questions',
      '  !answer, !a - Answer a question',
      '  !solve, !solved - Mark question as solved',
      '',
      '👥 Groups:',
      '  !groups - List all groups',
      '  !join - Self-service group joining (members only)',
      '  !refreshgroups - Force refresh group cache',
    ];

    if (isUserAdmin) {
      lines.push('  !addto <group#> @user - Add users to group');
    }

    lines.push(
      '',
      '📚 Wiki & Knowledge:',
      '  !wiki - Wiki links',
      '  !wikisearch, !ws - Search wiki',
      '  !wikiask, !wa - AI-powered wiki Q&A',
      '',
      '📚 Information:',
      '  !forum, !links, !faq, !docs, !events',
      '',
      '💬 Forum:',
      '  !fpost - Create forum post',
      '  !flatest - Latest forum posts',
      '  !fsearch - Search forum',
      '  !categories - Forum categories',
      '',
      '🎲 Utility:',
      '  !time, !flip, !fact, !8ball, !calc, !random, !cast',
      '',
      '🎰 Dice Game (Street Craps):',
      '  !dice @user1 @user2 - Start multiplayer game',
      '  !roll, !pass, !fade, !points, !leave',
      '',
      '👤 User:',
      '  !req, !request - Join community request',
      ''
    );

    if (isUserAdmin) {
      lines.push(
        '🔐 Admin:',
        '  !gtg @user - Approve user (Good To Go)',
        '  !pending - Show pending users',
        '  !remove @user - Remove from all groups (safety number)',
        '  !clearroom confirm - Remove all non-admins from current group',
        '  !createuser @user email - Create SSO account for mentioned user',
        '  !createuser email name - Create SSO account with name',
        '',
        '📢 Announcements:',
        '  !announce [-t time] [-g groups] [-dm] message',
        '  !announcements - List pending',
        '  !cancelannounce <id> - Cancel scheduled',
        ''
      );
    }

    lines.push('💡 Use any command to get started!');

    if (isUserAdmin) {
      lines.push('🔒 You have admin access to restricted commands');
    }

    const helpText = this.formatForSignal(lines.join('\n'));

    // Add a random meme to the help response
    const meme = getRandomMeme();
    const filePath = getMemeFilePath(meme);
    const exists = await memeFileExists(meme);

    if (exists) {
      return {
        text: helpText,
        attachment: filePath,
      };
    }

    // Fallback to just text if meme not available
    return helpText;
  }

  private formatForSignal(text: string): string {
    return text
      // Remove headers (### Header -> HEADER)
      .replace(/^#{1,6}\s+(.+)$/gm, (_, content) => content.toUpperCase())
      // Remove bold/italic markers (**bold** or *italic* -> text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove inline code (`code` -> code)
      .replace(/`([^`]+)`/g, '$1')
      // Remove links [text](url) -> text (url)
      .replace(/[[^\]]+]\]\(([^)]+)\)/g, '$1 ($2)')
      // Clean up multiple blank lines
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
