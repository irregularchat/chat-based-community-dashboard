import { Command, CommandContext, CommandResponse } from './base-command';

export class PingCommand extends Command {
  public name = 'ping';
  public description = 'Test bot responsiveness';
  public aliases = [];

  public async handle(context: CommandContext, args: string): Promise<CommandResponse> {
    return '🏓 Pong! Bot is responsive.\n\n✅ All systems operational.';
  }
}
