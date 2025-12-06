/**
 * Dice Game - Street Craps Implementation
 *
 * A multiplayer dice game for Signal groups featuring simplified casino craps.
 * Players can bet with or against the shooter and compete for virtual points.
 */

export interface Player {
  uuid: string;
  name: string;
  phoneNumber?: string;
  points: number;
  bet?: 'pass' | 'fade';  // pass = with shooter, fade = against
  betAmount?: number;
  lastActivity: number;
  isShooter?: boolean;
  totalWon: number;   // Track lifetime winnings
  totalLost: number;  // Track lifetime losses
  roundsPlayed: number;
  // Hold betting - persistent bet that auto-applies each round
  holdBet?: 'pass' | 'fade';  // Held bet type
  holdAmount?: number;        // Held bet amount
  eliminated?: boolean;       // Already announced as eliminated
}

export interface DiceRoll {
  dice: [number, number];
  total: number;
  timestamp: number;
}

export type GamePhase = 'waiting' | 'betting' | 'come_out' | 'point' | 'finished';

export interface GameState {
  id: string;
  groupId?: string;
  phase: GamePhase;
  players: Map<string, Player>;
  shooterUuid?: string;
  shooterOrder: string[];  // Order of shooters
  shooterStake: number;    // Shooter's stake for the round
  point?: number;
  rolls: DiceRoll[];
  roundNumber: number;
  minBet: number;
  maxBet: number;
  createdAt: number;
  lastActivity: number;
  timeoutMs: number;  // How long to wait for responses
  // Betting timer fields
  bettingStartTime?: number;        // When betting phase started
  bettingTimeoutMs: number;         // Default 60000 (60 seconds)
  playersSkipped: Set<string>;      // Players who skipped betting this round
}

export interface GameResult {
  message: string;
  mentions?: string[];  // Signal CLI mention format: "start:length:uuid"
  winners?: Player[];
  losers?: Player[];
  nextPhase?: GamePhase;
  gameOver?: boolean;
}

// Unicode placeholder for Signal mentions - Signal replaces this with the display name
export const MENTION_PLACEHOLDER = '\uFFFC';

/**
 * Calculate the UTF-16 code unit length of a string
 * This is needed because Signal CLI mentions use UTF-16 positions, not character positions
 * Emojis and other characters outside BMP take 2 UTF-16 code units (surrogate pairs)
 */
export function utf16Length(str: string): number {
  // JavaScript strings are UTF-16, so .length gives us UTF-16 code units directly
  return str.length;
}

/**
 * Helper to build a player mention placeholder and track mention position
 * Returns { text, mention } where text includes the placeholder and mention is in Signal CLI format
 */
export function buildPlayerMention(uuid: string, currentPosition: number): { text: string; mention: string } {
  return {
    text: MENTION_PLACEHOLDER,
    mention: `${currentPosition}:1:${uuid}`
  };
}

// Game constants
const STARTING_POINTS = 100;
const DEFAULT_MIN_BET = 10;
const DEFAULT_MAX_BET = 50;
const DEFAULT_TIMEOUT_MS = 60000;  // 1 minute to respond
const DEFAULT_BETTING_TIMEOUT_MS = 60000;  // 60 seconds for betting phase
const INACTIVITY_TIMEOUT_MS = 180000;  // 3 minutes of inactivity = kicked

// Dice emoji mapping
const DICE_EMOJI: Record<number, string> = {
  1: '⚀',
  2: '⚁',
  3: '⚂',
  4: '⚃',
  5: '⚄',
  6: '⚅'
};

/**
 * Active games storage (in-memory for now)
 * Could be moved to Redis/PostgreSQL for persistence
 */
const activeGames = new Map<string, GameState>();

/**
 * Generate a unique game ID
 */
function generateGameId(): string {
  return `dice_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Roll two dice
 */
export function rollDice(): DiceRoll {
  const die1 = Math.floor(Math.random() * 6) + 1;
  const die2 = Math.floor(Math.random() * 6) + 1;
  return {
    dice: [die1, die2],
    total: die1 + die2,
    timestamp: Date.now()
  };
}

/**
 * Format dice roll for display
 */
export function formatRoll(roll: DiceRoll): string {
  const [d1, d2] = roll.dice;
  return `${DICE_EMOJI[d1]} ${DICE_EMOJI[d2]} = ${roll.total}`;
}

/**
 * Create a new dice game
 */
export function createGame(creatorUuid: string, creatorName: string, players: Array<{uuid: string; name: string; phoneNumber?: string}>): GameState {
  const gameId = generateGameId();
  const now = Date.now();

  const playerMap = new Map<string, Player>();

  // Add creator first (they're the first shooter)
  playerMap.set(creatorUuid, {
    uuid: creatorUuid,
    name: creatorName,
    points: STARTING_POINTS,
    lastActivity: now,
    isShooter: true,
    totalWon: 0,
    totalLost: 0,
    roundsPlayed: 0
  });

  // Add other players
  const shooterOrder = [creatorUuid];
  for (const p of players) {
    if (p.uuid !== creatorUuid) {
      playerMap.set(p.uuid, {
        uuid: p.uuid,
        name: p.name,
        phoneNumber: p.phoneNumber,
        points: STARTING_POINTS,
        lastActivity: now,
        totalWon: 0,
        totalLost: 0,
        roundsPlayed: 0
      });
      shooterOrder.push(p.uuid);
    }
  }

  const game: GameState = {
    id: gameId,
    phase: 'waiting',
    players: playerMap,
    shooterUuid: creatorUuid,
    shooterOrder,
    shooterStake: DEFAULT_MIN_BET,  // Default shooter stake
    rolls: [],
    roundNumber: 1,
    minBet: DEFAULT_MIN_BET,
    maxBet: DEFAULT_MAX_BET,
    createdAt: now,
    lastActivity: now,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    bettingTimeoutMs: DEFAULT_BETTING_TIMEOUT_MS,
    playersSkipped: new Set<string>()
  };

  activeGames.set(gameId, game);
  return game;
}

/**
 * Create a new game in an existing group (for rematch)
 * Takes the groupId and creates a fresh game with the provided players
 */
export function createGameInGroup(
  groupId: string,
  creatorUuid: string,
  creatorName: string,
  players: Array<{uuid: string; name: string; phoneNumber?: string}>
): GameState {
  // First, end any existing game in this group
  const existingGame = getGameByGroupId(groupId);
  if (existingGame) {
    activeGames.delete(existingGame.id);
  }

  // Create the new game
  const game = createGame(creatorUuid, creatorName, players);

  // Associate it with the existing group
  game.groupId = groupId;

  return game;
}

/**
 * Get game rules message
 */
export function getGameRules(): string {
  return `🎲 STREET CRAPS RULES 🎲

━━━━━━━━━━━━━━━━━━━━━━
📋 BASICS
━━━━━━━━━━━━━━━━━━━━━━
• Everyone starts with ${STARTING_POINTS} points
• Shooter stakes points, others bet FOR or AGAINST
• Shooter keeps rolling until they win or seven out

━━━━━━━━━━━━━━━━━━━━━━
🎯 COME-OUT ROLL (First Roll)
━━━━━━━━━━━━━━━━━━━━━━
• 7 or 11 → Shooter WINS!
• 2, 3, or 12 → "CRAPS!" Shooter LOSES
• 4, 5, 6, 8, 9, or 10 → That's the POINT

━━━━━━━━━━━━━━━━━━━━━━
🎯 POINT PHASE (After Point Set)
━━━━━━━━━━━━━━━━━━━━━━
• Roll the POINT again → Shooter WINS!
• Roll a 7 → "SEVEN OUT!" Shooter LOSES

━━━━━━━━━━━━━━━━━━━━━━
💰 PAYOUTS (1:1)
━━━━━━━━━━━━━━━━━━━━━━
• Pass bets pay 1:1 when shooter wins
• Fade bets pay 1:1 when shooter loses
• Shooter collects first, then pass bettors
• Min: ${DEFAULT_MIN_BET} pts | Max: ${DEFAULT_MAX_BET} pts

━━━━━━━━━━━━━━━━━━━━━━
🔒 HOLD BETTING
━━━━━━━━━━━━━━━━━━━━━━
• !hold pass [amt] - Auto-bet pass each round
• !hold fade [amt] - Auto-bet fade each round
• !hold off - Clear hold, go manual
• Holds auto-apply when betting opens!

━━━━━━━━━━━━━━━━━━━━━━
🎮 COMMANDS
━━━━━━━━━━━━━━━━━━━━━━
• !roll [amt] - Shooter rolls (sets stake)
• !go - Shooter rolls early
• !pass [amt] / !fade [amt] - Bet once
• !hold [pass/fade] [amt] - Auto-bet
• !skip - Skip this round
• !points - Check balance
• !gs - Game status
• !leave - Leave game

Let's play! 🎲`;
}

/**
 * Get game by ID
 */
export function getGame(gameId: string): GameState | undefined {
  return activeGames.get(gameId);
}

/**
 * Get game by group ID
 */
export function getGameByGroupId(groupId: string): GameState | undefined {
  for (const game of activeGames.values()) {
    if (game.groupId === groupId) {
      return game;
    }
  }
  return undefined;
}

/**
 * Set the group ID for a game
 */
export function setGameGroupId(gameId: string, groupId: string): void {
  const game = activeGames.get(gameId);
  if (game) {
    game.groupId = groupId;
  }
}

/**
 * Start betting phase with timer (returns message with Signal mentions)
 */
export function startBetting(game: GameState): GameResult {
  game.phase = 'betting';
  game.lastActivity = Date.now();
  game.bettingStartTime = Date.now();
  game.playersSkipped.clear();  // Reset skipped players for new round

  const shooter = game.players.get(game.shooterUuid!);

  // Apply any held bets first
  const holdResults = applyHeldBetsWithMentions(game);

  const timeoutSecs = Math.floor(game.bettingTimeoutMs / 1000);

  // Build header with shooter mention
  const mentions: string[] = [];
  let header = `━━━━━━━━━━━━━━━━━━━━━━
🎲 ROUND ${game.roundNumber} - PLACE YOUR BETS!
━━━━━━━━━━━━━━━━━━━━━━

🎯 SHOOTER: `;
  let currentPosition = header.length;

  // Add shooter mention
  if (shooter) {
    mentions.push(`${currentPosition}:1:${shooter.uuid}`);
  }
  header += `${MENTION_PLACEHOLDER}
💎 STAKE: ${game.shooterStake} pts

`;
  currentPosition = header.length;

  // Generate leaderboard with mentions
  const leaderboard = getLeaderboardWithMentions(game, currentPosition);
  mentions.push(...leaderboard.mentions);
  currentPosition = leaderboard.endPosition;

  let message = header + leaderboard.text;

  // Add hold results if any
  if (holdResults.text) {
    message += `\n\n${holdResults.text}`;
    currentPosition = message.length;
    mentions.push(...holdResults.mentions);
  }

  // Check ready status after applying holds
  const readyStatus = checkAllPlayersReadyWithMentions(game, message.length + 1);

  message += `
━━━━━━━━━━━━━━━━━━━━━━
💰 BETTING OPEN (${timeoutSecs}s)
━━━━━━━━━━━━━━━━━━━━━━
• !pass [amt] - Bet WITH shooter
• !fade [amt] - Bet AGAINST shooter
• !hold [pass/fade] [amt] - Auto-bet
• !skip - Skip this round

${readyStatus.text}`;

  mentions.push(...readyStatus.mentions);

  return { message, mentions };
}

/**
 * Get leaderboard showing all players' points with Signal mentions
 * Returns text with mention placeholders and an array of mention strings
 */
function getLeaderboardWithMentions(game: GameState, startPosition: number): { text: string; mentions: string[]; endPosition: number } {
  const sortedPlayers = Array.from(game.players.values())
    .sort((a, b) => b.points - a.points);

  const mentions: string[] = [];
  let currentPosition = startPosition;

  const header = '📊 STANDINGS:\n';
  currentPosition += header.length;

  const lines: string[] = [];
  for (let i = 0; i < sortedPlayers.length; i++) {
    const p = sortedPlayers[i];
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const shooterMark = p.isShooter ? ' 🎯' : '';
    const netChange = p.totalWon - p.totalLost;
    const netStr = netChange >= 0 ? `+${netChange}` : `${netChange}`;

    // Build line with mention placeholder
    const prefix = `${medal} `;
    currentPosition += prefix.length;

    // Add mention for player
    mentions.push(`${currentPosition}:1:${p.uuid}`);

    const suffix = `: ${p.points} pts (${netStr})${shooterMark}\n`;
    lines.push(`${prefix}${MENTION_PLACEHOLDER}${suffix}`);
    currentPosition += 1 + suffix.length; // 1 for placeholder
  }

  return {
    text: header + lines.join(''),
    mentions,
    endPosition: currentPosition
  };
}

/**
 * Get leaderboard showing all players' points (legacy string version for internal use)
 */
function getLeaderboard(game: GameState): string {
  const sortedPlayers = Array.from(game.players.values())
    .sort((a, b) => b.points - a.points);

  const lines = ['📊 STANDINGS:'];
  for (let i = 0; i < sortedPlayers.length; i++) {
    const p = sortedPlayers[i];
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const shooterMark = p.isShooter ? ' 🎯' : '';
    const netChange = p.totalWon - p.totalLost;
    const netStr = netChange >= 0 ? `+${netChange}` : `${netChange}`;
    lines.push(`${medal} ${p.name}: ${p.points} pts (${netStr})${shooterMark}`);
  }
  return lines.join('\n');
}

/**
 * Set shooter's stake for the round
 */
export function setShooterStake(game: GameState, playerUuid: string, amount: number): GameResult {
  if (playerUuid !== game.shooterUuid) {
    return { message: '❌ Only the shooter can set the stake!' };
  }

  if (game.phase !== 'betting' && game.phase !== 'waiting') {
    return { message: '❌ Cannot change stake now - round in progress!' };
  }

  const shooter = game.players.get(playerUuid);
  if (!shooter) {
    return { message: '❌ Player not found!' };
  }

  if (amount < game.minBet) {
    return { message: `❌ Minimum stake is ${game.minBet} points!` };
  }

  if (amount > game.maxBet) {
    return { message: `❌ Maximum stake is ${game.maxBet} points!` };
  }

  if (amount > shooter.points) {
    return { message: `❌ You only have ${shooter.points} points!` };
  }

  game.shooterStake = amount;
  game.lastActivity = Date.now();

  return { message: `🎯 ${shooter.name} sets stake to ${amount} pts!\n\nOthers: bet !pass or !fade against this stake.` };
}

/**
 * Place a bet
 */
export function placeBet(game: GameState, playerUuid: string, betType: 'pass' | 'fade', amount: number): GameResult {
  const player = game.players.get(playerUuid);

  if (!player) {
    return { message: '❌ You are not in this game!' };
  }

  if (game.phase !== 'betting' && game.phase !== 'come_out') {
    return { message: '❌ Betting is closed for this round!' };
  }

  if (playerUuid === game.shooterUuid) {
    return { message: `❌ Shooter can't bet! Use !stake [amt] to set your stake (currently ${game.shooterStake} pts).` };
  }

  if (amount < game.minBet) {
    return { message: `❌ Minimum bet is ${game.minBet} points!` };
  }

  if (amount > game.maxBet) {
    return { message: `❌ Maximum bet is ${game.maxBet} points!` };
  }

  if (amount > player.points) {
    return { message: `❌ You only have ${player.points} points!` };
  }

  player.bet = betType;
  player.betAmount = amount;
  player.lastActivity = Date.now();
  game.lastActivity = Date.now();

  const betEmoji = betType === 'pass' ? '✅' : '❌';
  const betDesc = betType === 'pass' ? 'WITH' : 'AGAINST';

  // Show current bet summary and ready status
  const readyStatus = checkAllPlayersReady(game);

  return {
    message: `${betEmoji} ${player.name} bets ${amount} pts ${betDesc} the shooter!\n\n${readyStatus}`
  };
}

/**
 * Player skips betting for this round
 */
export function playerSkipBetting(game: GameState, playerUuid: string): GameResult {
  const player = game.players.get(playerUuid);

  if (!player) {
    return { message: '❌ You are not in this game!' };
  }

  if (game.phase !== 'betting') {
    return { message: '❌ Cannot skip - betting phase not active!' };
  }

  if (playerUuid === game.shooterUuid) {
    return { message: '❌ Shooter cannot skip! Use !roll to roll the dice.' };
  }

  // If player already bet, they can't skip
  if (player.bet && player.betAmount) {
    return { message: `❌ You already bet ${player.betAmount} pts on ${player.bet}!` };
  }

  // Mark player as skipped
  game.playersSkipped.add(playerUuid);
  game.lastActivity = Date.now();
  player.lastActivity = Date.now();

  // Check if all non-shooter players have bet or skipped
  const readyStatus = checkAllPlayersReady(game);

  return {
    message: `⏭️ ${player.name} skips betting this round.\n\n${readyStatus}`
  };
}

/**
 * Check if all non-shooter players have bet or skipped
 */
export function checkAllPlayersReady(game: GameState): string {
  const nonShooterPlayers = Array.from(game.players.entries())
    .filter(([uuid]) => uuid !== game.shooterUuid);

  const readyPlayers: string[] = [];
  const waitingPlayers: string[] = [];

  for (const [uuid, player] of nonShooterPlayers) {
    if (player.bet && player.betAmount) {
      readyPlayers.push(`${player.name} (${player.bet} ${player.betAmount})`);
    } else if (game.playersSkipped.has(uuid)) {
      readyPlayers.push(`${player.name} (skip)`);
    } else {
      waitingPlayers.push(player.name);
    }
  }

  const allReady = waitingPlayers.length === 0;
  const shooter = game.players.get(game.shooterUuid!);

  if (allReady) {
    return `✅ All players ready!\n🎯 ${shooter?.name}, type !roll to roll the dice!`;
  }

  // Calculate time remaining
  const elapsed = game.bettingStartTime ? Date.now() - game.bettingStartTime : 0;
  const remaining = Math.max(0, Math.ceil((game.bettingTimeoutMs - elapsed) / 1000));

  return `⏳ Waiting: ${waitingPlayers.join(', ')}\n✅ Ready: ${readyPlayers.length > 0 ? readyPlayers.join(', ') : 'none'}\n⏱️ ${remaining}s remaining (or shooter can !go when ready)`;
}

/**
 * Check if all non-shooter players have bet or skipped (with Signal mentions)
 */
function checkAllPlayersReadyWithMentions(game: GameState, startPosition: number): { text: string; mentions: string[] } {
  const nonShooterPlayers = Array.from(game.players.entries())
    .filter(([uuid]) => uuid !== game.shooterUuid);

  const mentions: string[] = [];
  const readyPlayerData: Array<{ uuid: string; suffix: string }> = [];
  const waitingPlayerData: Array<{ uuid: string }> = [];

  for (const [uuid, player] of nonShooterPlayers) {
    if (player.bet && player.betAmount) {
      readyPlayerData.push({ uuid, suffix: ` (${player.bet} ${player.betAmount})` });
    } else if (game.playersSkipped.has(uuid)) {
      readyPlayerData.push({ uuid, suffix: ' (skip)' });
    } else {
      waitingPlayerData.push({ uuid });
    }
  }

  const allReady = waitingPlayerData.length === 0;
  const shooter = game.players.get(game.shooterUuid!);

  if (allReady && shooter) {
    // All ready message with shooter mention
    const prefix = '✅ All players ready!\n🎯 ';
    let currentPos = startPosition + prefix.length;
    mentions.push(`${currentPos}:1:${shooter.uuid}`);
    return {
      text: `${prefix}${MENTION_PLACEHOLDER}, type !roll to roll the dice!`,
      mentions
    };
  }

  // Calculate time remaining
  const elapsed = game.bettingStartTime ? Date.now() - game.bettingStartTime : 0;
  const remaining = Math.max(0, Math.ceil((game.bettingTimeoutMs - elapsed) / 1000));

  // Build the waiting and ready lists with mentions
  let text = '⏳ Waiting: ';
  let currentPos = startPosition + text.length;

  // Add waiting players
  for (let i = 0; i < waitingPlayerData.length; i++) {
    const p = waitingPlayerData[i];
    mentions.push(`${currentPos}:1:${p.uuid}`);
    text += MENTION_PLACEHOLDER;
    currentPos += 1;
    if (i < waitingPlayerData.length - 1) {
      text += ', ';
      currentPos += 2;
    }
  }

  text += '\n✅ Ready: ';
  currentPos = startPosition + text.length;

  if (readyPlayerData.length === 0) {
    text += 'none';
  } else {
    for (let i = 0; i < readyPlayerData.length; i++) {
      const p = readyPlayerData[i];
      mentions.push(`${currentPos}:1:${p.uuid}`);
      text += `${MENTION_PLACEHOLDER}${p.suffix}`;
      currentPos += 1 + p.suffix.length;
      if (i < readyPlayerData.length - 1) {
        text += ', ';
        currentPos += 2;
      }
    }
  }

  text += `\n⏱️ ${remaining}s remaining (or shooter can !go when ready)`;

  return { text, mentions };
}

/**
 * Check if all players are ready (have bet or skipped)
 */
export function areAllPlayersReady(game: GameState): boolean {
  for (const [uuid, player] of game.players) {
    if (uuid === game.shooterUuid) continue;
    if (!player.bet && !player.betAmount && !game.playersSkipped.has(uuid)) {
      return false;
    }
  }
  return true;
}

/**
 * Shooter signals they're ready to roll early (!go command)
 * This ends the betting phase and allows them to roll
 */
export function shooterReadyToRoll(game: GameState, playerUuid: string): GameResult {
  if (playerUuid !== game.shooterUuid) {
    return { message: '❌ Only the shooter can use !go!' };
  }

  if (game.phase !== 'betting') {
    return { message: '❌ Cannot use !go - not in betting phase!' };
  }

  const shooter = game.players.get(game.shooterUuid!);
  const betSummary = getBetSummary(game);

  // Mark any players who didn't bet as auto-skipped
  for (const [uuid, player] of game.players) {
    if (uuid === game.shooterUuid) continue;
    if (!player.bet && !player.betAmount && !game.playersSkipped.has(uuid)) {
      game.playersSkipped.add(uuid);
    }
  }

  return {
    message: `🚀 ${shooter?.name} is ready to roll!\n\n${betSummary}\n\n🎲 Type !roll to throw the dice!`
  };
}

/**
 * Set or clear a hold bet (!hold command)
 * !hold pass 20 - Hold pass bet of 20 for each round
 * !hold fade 15 - Hold fade bet of 15 for each round
 * !hold off - Clear hold
 * !hold - Show current hold status
 */
export function setHoldBet(
  game: GameState,
  playerUuid: string,
  betType?: 'pass' | 'fade' | 'off',
  amount?: number
): GameResult {
  const player = game.players.get(playerUuid);

  if (!player) {
    return { message: '❌ You are not in this game!' };
  }

  if (playerUuid === game.shooterUuid) {
    return { message: '❌ Shooter cannot hold bets! Use !stake to set your stake.' };
  }

  // No arguments - show current hold status
  if (!betType) {
    if (player.holdBet && player.holdAmount) {
      return {
        message: `🔒 ${player.name}'s hold: ${player.holdBet.toUpperCase()} ${player.holdAmount} pts\n\nUse !hold off to clear.`
      };
    } else {
      return {
        message: `📭 ${player.name} has no hold set.\n\nUse !hold pass [amt] or !hold fade [amt] to auto-bet each round.`
      };
    }
  }

  // Clear hold
  if (betType === 'off') {
    player.holdBet = undefined;
    player.holdAmount = undefined;
    return { message: `🔓 ${player.name} cleared their hold. Manual betting each round.` };
  }

  // Set hold - validate amount
  if (!amount || amount < game.minBet) {
    return { message: `❌ Minimum hold amount is ${game.minBet} points!` };
  }

  if (amount > game.maxBet) {
    return { message: `❌ Maximum hold amount is ${game.maxBet} points!` };
  }

  player.holdBet = betType;
  player.holdAmount = amount;

  const emoji = betType === 'pass' ? '✅' : '❌';
  const desc = betType === 'pass' ? 'WITH' : 'AGAINST';

  return {
    message: `🔒 ${player.name} holds ${emoji} ${betType.toUpperCase()} ${amount} pts\n\nWill auto-bet ${desc} shooter each round until cleared with !hold off.`
  };
}

/**
 * Apply all held bets at the start of betting phase
 * Returns a summary of auto-applied bets
 */
export function applyHeldBets(game: GameState): string {
  const appliedBets: string[] = [];
  const skippedBets: string[] = [];

  for (const [uuid, player] of game.players) {
    if (uuid === game.shooterUuid) continue;
    if (!player.holdBet || !player.holdAmount) continue;

    // Check if player has enough points
    if (player.points < player.holdAmount) {
      // Not enough points - clear the hold
      skippedBets.push(`${player.name} (insufficient pts - hold cleared)`);
      player.holdBet = undefined;
      player.holdAmount = undefined;
      continue;
    }

    // Apply the held bet
    player.bet = player.holdBet;
    player.betAmount = player.holdAmount;
    player.lastActivity = Date.now();

    const emoji = player.holdBet === 'pass' ? '✅' : '❌';
    appliedBets.push(`${emoji} ${player.name}: ${player.holdBet} ${player.holdAmount}`);
  }

  if (appliedBets.length === 0 && skippedBets.length === 0) {
    return '';
  }

  let result = '';
  if (appliedBets.length > 0) {
    result += `🔒 AUTO-BETS APPLIED:\n${appliedBets.join('\n')}`;
  }
  if (skippedBets.length > 0) {
    if (result) result += '\n\n';
    result += `⚠️ HOLDS CLEARED:\n${skippedBets.join('\n')}`;
  }

  return result;
}

/**
 * Apply all held bets with Signal mentions
 */
function applyHeldBetsWithMentions(game: GameState): { text: string; mentions: string[] } {
  const mentions: string[] = [];
  const appliedLines: Array<{ uuid: string; emoji: string; holdBet: string; holdAmount: number }> = [];
  const skippedLines: Array<{ uuid: string; text: string }> = [];

  for (const [uuid, player] of game.players) {
    if (uuid === game.shooterUuid) continue;
    if (!player.holdBet || !player.holdAmount) continue;

    // Check if player has enough points
    if (player.points < player.holdAmount) {
      skippedLines.push({ uuid, text: ` (insufficient pts - hold cleared)` });
      player.holdBet = undefined;
      player.holdAmount = undefined;
      continue;
    }

    // Apply the held bet
    player.bet = player.holdBet;
    player.betAmount = player.holdAmount;
    player.lastActivity = Date.now();

    const emoji = player.holdBet === 'pass' ? '✅' : '❌';
    appliedLines.push({ uuid, emoji, holdBet: player.holdBet, holdAmount: player.holdAmount });
  }

  if (appliedLines.length === 0 && skippedLines.length === 0) {
    return { text: '', mentions: [] };
  }

  let text = '';
  let currentPos = 0;

  if (appliedLines.length > 0) {
    const header = '🔒 AUTO-BETS APPLIED:\n';
    text += header;
    currentPos = header.length;

    for (const item of appliedLines) {
      const prefix = `${item.emoji} `;
      currentPos += prefix.length;
      mentions.push(`${currentPos}:1:${item.uuid}`);
      const suffix = `: ${item.holdBet} ${item.holdAmount}\n`;
      text += `${prefix}${MENTION_PLACEHOLDER}${suffix}`;
      currentPos += 1 + suffix.length;
    }
  }

  if (skippedLines.length > 0) {
    if (text) {
      text += '\n';
      currentPos = text.length;
    }
    const header = '⚠️ HOLDS CLEARED:\n';
    text += header;
    currentPos = text.length;

    for (const item of skippedLines) {
      mentions.push(`${currentPos}:1:${item.uuid}`);
      const suffix = `${item.text}\n`;
      text += `${MENTION_PLACEHOLDER}${suffix}`;
      currentPos += 1 + suffix.length;
    }
  }

  return { text: text.trimEnd(), mentions };
}

/**
 * Get a summary of all current holds
 */
export function getHoldsSummary(game: GameState): string {
  const holds: string[] = [];

  for (const [uuid, player] of game.players) {
    if (uuid === game.shooterUuid) continue;
    if (player.holdBet && player.holdAmount) {
      const emoji = player.holdBet === 'pass' ? '✅' : '❌';
      holds.push(`${emoji} ${player.name}: ${player.holdBet} ${player.holdAmount}`);
    }
  }

  if (holds.length === 0) {
    return '';
  }

  return `🔒 HOLDS:\n${holds.join('\n')}`;
}

/**
 * Check if betting timer has expired
 */
export function isBettingTimeExpired(game: GameState): boolean {
  if (!game.bettingStartTime) return false;
  const elapsed = Date.now() - game.bettingStartTime;
  return elapsed >= game.bettingTimeoutMs;
}

/**
 * Get remaining betting time in seconds
 */
export function getBettingTimeRemaining(game: GameState): number {
  if (!game.bettingStartTime) return game.bettingTimeoutMs / 1000;
  const elapsed = Date.now() - game.bettingStartTime;
  return Math.max(0, Math.ceil((game.bettingTimeoutMs - elapsed) / 1000));
}

/**
 * Get a summary of all current bets
 */
export function getBetSummary(game: GameState): string {
  const shooter = game.players.get(game.shooterUuid!);
  const lines: string[] = [];

  lines.push(`📋 BET SUMMARY:`);
  lines.push(`🎯 ${shooter?.name || 'Shooter'} stakes ${game.shooterStake} pts`);

  let passTotal = 0;
  let fadeTotal = 0;
  const passBettors: string[] = [];
  const fadeBettors: string[] = [];
  const noBet: string[] = [];

  for (const [uuid, player] of game.players) {
    if (uuid === game.shooterUuid) continue;

    if (player.bet === 'pass' && player.betAmount) {
      passTotal += player.betAmount;
      passBettors.push(`${player.name} (${player.betAmount})`);
    } else if (player.bet === 'fade' && player.betAmount) {
      fadeTotal += player.betAmount;
      fadeBettors.push(`${player.name} (${player.betAmount})`);
    } else {
      noBet.push(player.name);
    }
  }

  if (passBettors.length > 0) {
    lines.push(`✅ PASS (${passTotal} pts): ${passBettors.join(', ')}`);
  }
  if (fadeBettors.length > 0) {
    lines.push(`❌ FADE (${fadeTotal} pts): ${fadeBettors.join(', ')}`);
  }
  if (noBet.length > 0) {
    lines.push(`⏳ No bet yet: ${noBet.join(', ')}`);
  }

  if (passBettors.length === 0 && fadeBettors.length === 0) {
    lines.push(`⏳ Waiting for bets...`);
  }

  return lines.join('\n');
}

/**
 * Roll the dice (shooter only)
 */
export function shooterRoll(game: GameState, playerUuid: string): GameResult {
  if (playerUuid !== game.shooterUuid) {
    return { message: '❌ Only the shooter can roll!' };
  }

  if (game.phase !== 'betting' && game.phase !== 'come_out' && game.phase !== 'point') {
    return { message: '❌ Cannot roll right now!' };
  }

  // Show bet summary before come-out roll
  const isFirstRoll = game.phase === 'betting' || game.phase === 'come_out';
  const preBetSummary = isFirstRoll ? getBetSummary(game) + '\n\n' : '';

  const roll = rollDice();
  game.rolls.push(roll);
  game.lastActivity = Date.now();

  const shooter = game.players.get(game.shooterUuid)!;
  shooter.lastActivity = Date.now();

  // Process the roll based on game phase
  if (isFirstRoll) {
    return processComeOutRoll(game, roll, preBetSummary);
  } else {
    return processPointRoll(game, roll);
  }
}

/**
 * Process come-out roll
 */
function processComeOutRoll(game: GameState, roll: DiceRoll, betSummary: string): GameResult {
  const shooter = game.players.get(game.shooterUuid!)!;
  const rollDisplay = formatRoll(roll);

  if (roll.total === 7 || roll.total === 11) {
    // Natural win!
    game.phase = 'come_out';
    const result = resolveRound(game, true);

    return {
      message: `${betSummary}🎲 ${shooter.name} rolls... ${rollDisplay}

🎉 NATURAL ${roll.total}! SHOOTER WINS! 🎉

${result}`,
      nextPhase: 'betting'
    };
  }

  if (roll.total === 2 || roll.total === 3 || roll.total === 12) {
    // Craps! Shooter loses
    const result = resolveRound(game, false);

    return {
      message: `${betSummary}🎲 ${shooter.name} rolls... ${rollDisplay}

💀 CRAPS! ${roll.total === 12 ? 'BOXCARS!' : roll.total === 2 ? 'SNAKE EYES!' : 'ACE-DEUCE!'} 💀
Shooter loses!

${result}`,
      nextPhase: 'betting'
    };
  }

  // Point is set
  game.point = roll.total;
  game.phase = 'point';

  return {
    message: `${betSummary}🎲 ${shooter.name} rolls... ${rollDisplay}

🎯 POINT IS ${game.point}! 🎯

${shooter.name} must roll ${game.point} again before rolling a 7!
Bets remain in play until the point is made or seven-out.

Type !roll to continue...`,
    nextPhase: 'point'
  };
}

/**
 * Process point phase roll
 */
function processPointRoll(game: GameState, roll: DiceRoll): GameResult {
  const shooter = game.players.get(game.shooterUuid!)!;
  const rollDisplay = formatRoll(roll);

  if (roll.total === game.point) {
    // Made the point!
    const result = resolveRound(game, true);
    game.phase = 'come_out';
    game.point = undefined;

    return {
      message: `🎲 ${shooter.name} rolls... ${rollDisplay}

🎉🎉 POINT MADE! ${roll.total}! SHOOTER WINS! 🎉🎉

${result}

━━━━━━━━━━━━━━━━━━━━━━
Same shooter continues!
Type !roll when ready!`,
      nextPhase: 'betting'
    };
  }

  if (roll.total === 7) {
    // Seven out!
    const result = resolveRound(game, false);
    game.phase = 'come_out';
    game.point = undefined;

    return {
      message: `🎲 ${shooter.name} rolls... ${rollDisplay}

💀💀 SEVEN OUT! 💀💀
Shooter loses!

${result}

━━━━━━━━━━━━━━━━━━━━━━
Next shooter...`,
      nextPhase: 'betting'
    };
  }

  // Neither point nor 7
  return {
    message: `🎲 ${shooter.name} rolls... ${rollDisplay}

Point is still ${game.point}
Keep rolling! Type !roll`,
    nextPhase: 'point'
  };
}

/**
 * Resolve the round and calculate payouts
 *
 * PAYOUTS (1:1 system):
 * - Fade pool = total fader bets (money available to winners)
 * - Pass pool = shooter stake + total pass bets (money faders can win)
 *
 * When SHOOTER WINS:
 * - Faders lose their bets (goes to fade pool)
 * - Shooter wins 1:1 up to their stake from fade pool
 * - Pass bettors win 1:1 from remaining fade pool (proportional if not enough)
 *
 * When SHOOTER LOSES:
 * - Shooter loses their stake
 * - Pass bettors lose their bets
 * - Faders split the pass pool proportionally (1:1 up to their bet)
 */
function resolveRound(game: GameState, shooterWins: boolean): string {
  const shooter = game.players.get(game.shooterUuid!)!;
  const lines: string[] = [];

  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('💰 ROUND RESULTS');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');

  // Calculate totals
  let totalFadeBets = 0;
  let totalPassBets = 0;
  const faders: Array<{uuid: string, player: Player}> = [];
  const passers: Array<{uuid: string, player: Player}> = [];

  for (const [uuid, player] of game.players) {
    if (uuid === game.shooterUuid) continue;
    if (player.bet === 'fade' && player.betAmount) {
      totalFadeBets += player.betAmount;
      faders.push({uuid, player});
    } else if (player.bet === 'pass' && player.betAmount) {
      totalPassBets += player.betAmount;
      passers.push({uuid, player});
    }
  }

  const shooterStake = game.shooterStake;
  let shooterWinnings = 0;

  if (shooterWins) {
    // === SHOOTER WINS ===
    // Fade pool is available: all fader bets
    let fadePoolRemaining = totalFadeBets;

    // Shooter collects 1:1 up to their stake
    const shooterPayout = Math.min(shooterStake, fadePoolRemaining);
    shooterWinnings = shooterPayout;
    fadePoolRemaining -= shooterPayout;

    // Process faders (they all lose their bets)
    for (const {player} of faders) {
      player.roundsPlayed++;
      player.points -= player.betAmount!;
      player.totalLost += player.betAmount!;
      lines.push(`❌ ${player.name}: -${player.betAmount} → ${player.points} pts`);
      player.bet = undefined;
      player.betAmount = undefined;
    }

    // Process pass bettors (they win from remaining fade pool)
    if (passers.length > 0 && fadePoolRemaining > 0) {
      // Calculate what pass bettors would ideally win (1:1)
      const idealPassWinnings = totalPassBets;
      const passPayoutRatio = Math.min(1, fadePoolRemaining / idealPassWinnings);

      for (const {player} of passers) {
        player.roundsPlayed++;
        const payout = Math.floor(player.betAmount! * passPayoutRatio);
        if (payout > 0) {
          player.points += payout;
          player.totalWon += payout;
          lines.push(`✅ ${player.name}: +${payout} → ${player.points} pts`);
        } else {
          lines.push(`➖ ${player.name}: +0 → ${player.points} pts (pool empty)`);
        }
        player.bet = undefined;
        player.betAmount = undefined;
      }
    } else if (passers.length > 0) {
      // No fade pool left for pass bettors
      for (const {player} of passers) {
        player.roundsPlayed++;
        lines.push(`➖ ${player.name}: +0 → ${player.points} pts (no faders)`);
        player.bet = undefined;
        player.betAmount = undefined;
      }
    }

  } else {
    // === SHOOTER LOSES ===
    // Pass pool is available: shooter stake + all pass bets
    let passPoolRemaining = shooterStake + totalPassBets;

    // Shooter loses their stake
    shooterWinnings = -Math.min(shooterStake, totalFadeBets); // Only lose what faders can take

    // Process pass bettors (they lose their bets)
    for (const {player} of passers) {
      player.roundsPlayed++;
      player.points -= player.betAmount!;
      player.totalLost += player.betAmount!;
      lines.push(`❌ ${player.name}: -${player.betAmount} → ${player.points} pts`);
      player.bet = undefined;
      player.betAmount = undefined;
    }

    // Process faders (they win from pass pool)
    if (faders.length > 0 && passPoolRemaining > 0) {
      // Calculate what faders would ideally win (1:1)
      const idealFadeWinnings = totalFadeBets;
      const fadePayoutRatio = Math.min(1, passPoolRemaining / idealFadeWinnings);

      for (const {player} of faders) {
        player.roundsPlayed++;
        const payout = Math.floor(player.betAmount! * fadePayoutRatio);
        player.points += payout;
        player.totalWon += payout;
        lines.push(`✅ ${player.name}: +${payout} → ${player.points} pts`);
        player.bet = undefined;
        player.betAmount = undefined;
      }
    }
  }

  // Update shooter's stats
  shooter.points += shooterWinnings;
  shooter.roundsPlayed++;
  if (shooterWinnings >= 0) {
    shooter.totalWon += shooterWinnings;
    lines.unshift(`🎯 ${shooter.name} (Shooter): +${shooterWinnings} → ${shooter.points} pts`);
  } else {
    shooter.totalLost += Math.abs(shooterWinnings);
    lines.unshift(`🎯 ${shooter.name} (Shooter): ${shooterWinnings} → ${shooter.points} pts`);
  }

  // Add leaderboard
  lines.push('');
  lines.push(getLeaderboard(game));

  // Rotate shooter if they lost
  if (!shooterWins) {
    rotateShooter(game);
    const newShooter = game.players.get(game.shooterUuid!);
    if (newShooter) {
      lines.push('');
      lines.push(`🎯 Next shooter: ${newShooter.name}`);
    }
  } else {
    lines.push('');
    lines.push(`🎯 ${shooter.name} keeps the dice!`);
  }

  game.roundNumber++;

  // Check for eliminated players
  const eliminated = checkEliminations(game);
  if (eliminated.length > 0) {
    lines.push('');
    lines.push('💸 ELIMINATED:');
    for (const p of eliminated) {
      lines.push(`  • ${p.name} is out of points!`);
    }
  }

  // Check for game over
  const activePlayers = Array.from(game.players.values()).filter(p => p.points > 0);
  if (activePlayers.length <= 1) {
    game.phase = 'finished';
    if (activePlayers.length === 1) {
      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━');
      lines.push(`🏆 ${activePlayers[0].name} WINS THE GAME! 🏆`);
      lines.push('━━━━━━━━━━━━━━━━━━━━━━');
    }
  }

  return lines.join('\n');
}

/**
 * Rotate to next shooter
 */
function rotateShooter(game: GameState): void {
  const currentIndex = game.shooterOrder.indexOf(game.shooterUuid!);
  const oldShooter = game.players.get(game.shooterUuid!);
  if (oldShooter) {
    oldShooter.isShooter = false;
  }

  // Find next shooter with points
  let nextIndex = (currentIndex + 1) % game.shooterOrder.length;
  let attempts = 0;

  while (attempts < game.shooterOrder.length) {
    const nextUuid = game.shooterOrder[nextIndex];
    const nextPlayer = game.players.get(nextUuid);

    if (nextPlayer && nextPlayer.points > 0) {
      game.shooterUuid = nextUuid;
      nextPlayer.isShooter = true;
      return;
    }

    nextIndex = (nextIndex + 1) % game.shooterOrder.length;
    attempts++;
  }
}

/**
 * Check for NEWLY eliminated players (0 or negative points, not already marked)
 */
function checkEliminations(game: GameState): Player[] {
  const newlyEliminated: Player[] = [];

  for (const [uuid, player] of game.players) {
    if (player.points <= 0 && !player.eliminated) {
      // Mark as eliminated so we don't announce again
      player.eliminated = true;
      newlyEliminated.push(player);
      // Remove from shooter rotation
      const idx = game.shooterOrder.indexOf(uuid);
      if (idx !== -1) {
        game.shooterOrder.splice(idx, 1);
      }
    }
  }

  return newlyEliminated;
}

/**
 * Get current game status
 */
export function getGameStatus(game: GameState): string {
  const shooter = game.players.get(game.shooterUuid!);
  const lines: string[] = [
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🎲 GAME STATUS - Round ${game.roundNumber}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `Phase: ${game.phase.toUpperCase()}`,
    game.point ? `Point: ${game.point}` : '',
    `Shooter: ${shooter?.name || 'None'}`,
    '',
    '💰 STANDINGS:'
  ];

  // Sort players by points
  const sortedPlayers = Array.from(game.players.values()).sort((a, b) => b.points - a.points);

  for (const player of sortedPlayers) {
    const shooterMark = player.isShooter ? ' 🎯' : '';
    const betInfo = player.bet ? ` (${player.bet} ${player.betAmount})` : '';
    lines.push(`  ${player.name}: ${player.points} pts${shooterMark}${betInfo}`);
  }

  return lines.filter(l => l !== '').join('\n');
}

/**
 * Get player points
 */
export function getPlayerPoints(game: GameState, playerUuid: string): string {
  const player = game.players.get(playerUuid);
  if (!player) {
    return '❌ You are not in this game!';
  }

  return `💰 ${player.name}: ${player.points} points`;
}

/**
 * Remove a player from the game
 */
export function removePlayer(game: GameState, playerUuid: string): GameResult {
  const player = game.players.get(playerUuid);
  if (!player) {
    return { message: '❌ Player not found!' };
  }

  const wasShooter = player.isShooter;
  const name = player.name;

  game.players.delete(playerUuid);

  // Remove from shooter order
  const idx = game.shooterOrder.indexOf(playerUuid);
  if (idx !== -1) {
    game.shooterOrder.splice(idx, 1);
  }

  // If they were shooter, rotate
  if (wasShooter && game.shooterOrder.length > 0) {
    rotateShooter(game);
    const newShooter = game.players.get(game.shooterUuid!);
    return {
      message: `👋 ${name} left the game.\n🎯 ${newShooter?.name} is now the shooter!`
    };
  }

  // Check if game should end
  if (game.players.size < 2) {
    game.phase = 'finished';
    const remaining = Array.from(game.players.values())[0];
    return {
      message: `👋 ${name} left the game.\n🏆 ${remaining?.name || 'No one'} wins by default!`,
      gameOver: true
    };
  }

  return { message: `👋 ${name} left the game.` };
}

/**
 * End a game
 */
export function endGame(gameId: string): void {
  activeGames.delete(gameId);
}

/**
 * Check for inactive players and kick them
 */
export function checkInactivePlayers(game: GameState): Player[] {
  const now = Date.now();
  const inactive: Player[] = [];

  for (const [uuid, player] of game.players) {
    if (now - player.lastActivity > INACTIVITY_TIMEOUT_MS) {
      inactive.push(player);
    }
  }

  return inactive;
}

/**
 * Get all active games (for debugging)
 */
export function getActiveGames(): Map<string, GameState> {
  return activeGames;
}
