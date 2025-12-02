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
  winners?: Player[];
  losers?: Player[];
  nextPhase?: GamePhase;
  gameOver?: boolean;
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
 * Start betting phase with timer
 */
export function startBetting(game: GameState): string {
  game.phase = 'betting';
  game.lastActivity = Date.now();
  game.bettingStartTime = Date.now();
  game.playersSkipped.clear();  // Reset skipped players for new round

  const shooter = game.players.get(game.shooterUuid!);

  // Apply any held bets first
  const holdResults = applyHeldBets(game);

  // Generate leaderboard
  const leaderboard = getLeaderboard(game);

  const timeoutSecs = Math.floor(game.bettingTimeoutMs / 1000);

  // Check ready status after applying holds
  const readyStatus = checkAllPlayersReady(game);

  let message = `━━━━━━━━━━━━━━━━━━━━━━
🎲 ROUND ${game.roundNumber} - PLACE YOUR BETS!
━━━━━━━━━━━━━━━━━━━━━━

🎯 SHOOTER: ${shooter?.name || 'Unknown'}
💎 STAKE: ${game.shooterStake} pts

${leaderboard}`;

  // Add hold results if any
  if (holdResults) {
    message += `\n\n${holdResults}`;
  }

  message += `\n
━━━━━━━━━━━━━━━━━━━━━━
💰 BETTING OPEN (${timeoutSecs}s)
━━━━━━━━━━━━━━━━━━━━━━
• !pass [amt] - Bet WITH shooter
• !fade [amt] - Bet AGAINST shooter
• !hold [pass/fade] [amt] - Auto-bet
• !skip - Skip this round

${readyStatus}`;

  return message;
}

/**
 * Get leaderboard showing all players' points
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
