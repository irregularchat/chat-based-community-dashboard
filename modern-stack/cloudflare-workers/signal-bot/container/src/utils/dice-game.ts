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
  point?: number;
  rolls: DiceRoll[];
  roundNumber: number;
  minBet: number;
  maxBet: number;
  createdAt: number;
  lastActivity: number;
  timeoutMs: number;  // How long to wait for responses
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
    isShooter: true
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
        lastActivity: now
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
    rolls: [],
    roundNumber: 1,
    minBet: DEFAULT_MIN_BET,
    maxBet: DEFAULT_MAX_BET,
    createdAt: now,
    lastActivity: now,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  activeGames.set(gameId, game);
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
• Shooter rolls dice until they "seven out"
• Others bet WITH (!pass) or AGAINST (!fade) the shooter

━━━━━━━━━━━━━━━━━━━━━━
🎯 COME-OUT ROLL (First Roll)
━━━━━━━━━━━━━━━━━━━━━━
• 7 or 11 → Shooter WINS! (pass wins, fade loses)
• 2, 3, or 12 → "CRAPS!" Shooter LOSES (fade wins)
• 4, 5, 6, 8, 9, or 10 → That's the POINT

━━━━━━━━━━━━━━━━━━━━━━
🎯 POINT PHASE (After Point Set)
━━━━━━━━━━━━━━━━━━━━━━
• Roll the POINT again → Shooter WINS!
• Roll a 7 → "SEVEN OUT!" Shooter LOSES
• Any other number → Keep rolling

━━━━━━━━━━━━━━━━━━━━━━
💰 BETTING
━━━━━━━━━━━━━━━━━━━━━━
• !pass [amount] - Bet WITH the shooter
• !fade [amount] - Bet AGAINST the shooter
• Min bet: ${DEFAULT_MIN_BET} pts | Max: ${DEFAULT_MAX_BET} pts

━━━━━━━━━━━━━━━━━━━━━━
🎮 COMMANDS
━━━━━━━━━━━━━━━━━━━━━━
• !roll - Shooter rolls dice
• !pass [amt] / !fade [amt] - Place bet
• !points - Check your balance
• !status - See game status
• !leave - Leave the game

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
 * Start betting phase
 */
export function startBetting(game: GameState): string {
  game.phase = 'betting';
  game.lastActivity = Date.now();

  const shooter = game.players.get(game.shooterUuid!);

  return `━━━━━━━━━━━━━━━━━━━━━━
🎲 ROUND ${game.roundNumber} - PLACE YOUR BETS!
━━━━━━━━━━━━━━━━━━━━━━
🎯 Shooter: ${shooter?.name || 'Unknown'}

💰 Place your bets:
• !pass [amount] - Bet WITH the shooter
• !fade [amount] - Bet AGAINST the shooter

Bets: ${DEFAULT_MIN_BET}-${DEFAULT_MAX_BET} points
⏱️ You have 60 seconds...

When ready: ${shooter?.name}, type !roll`;
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
    return { message: '❌ Shooter cannot bet! You\'re automatically betting on yourself.' };
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
  const betDesc = betType === 'pass' ? 'WITH the shooter' : 'AGAINST the shooter';

  return {
    message: `${betEmoji} ${player.name} bets ${amount} pts ${betDesc}!`
  };
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

  const roll = rollDice();
  game.rolls.push(roll);
  game.lastActivity = Date.now();

  const shooter = game.players.get(game.shooterUuid)!;
  shooter.lastActivity = Date.now();

  // Process the roll based on game phase
  if (game.phase === 'betting' || game.phase === 'come_out') {
    return processComeOutRoll(game, roll);
  } else {
    return processPointRoll(game, roll);
  }
}

/**
 * Process come-out roll
 */
function processComeOutRoll(game: GameState, roll: DiceRoll): GameResult {
  const shooter = game.players.get(game.shooterUuid!)!;
  const rollDisplay = formatRoll(roll);

  if (roll.total === 7 || roll.total === 11) {
    // Natural win!
    game.phase = 'come_out';
    const result = resolveRound(game, true);

    return {
      message: `🎲 ${shooter.name} rolls... ${rollDisplay}

🎉 NATURAL ${roll.total}! SHOOTER WINS! 🎉

${result}

━━━━━━━━━━━━━━━━━━━━━━
Next round starting...
Type !roll when ready!`,
      nextPhase: 'betting'
    };
  }

  if (roll.total === 2 || roll.total === 3 || roll.total === 12) {
    // Craps! Shooter loses
    const result = resolveRound(game, false);

    return {
      message: `🎲 ${shooter.name} rolls... ${rollDisplay}

💀 CRAPS! ${roll.total === 12 ? 'BOXCARS!' : roll.total === 2 ? 'SNAKE EYES!' : 'ACE-DEUCE!'} 💀
Shooter loses!

${result}

━━━━━━━━━━━━━━━━━━━━━━
Next shooter up...`,
      nextPhase: 'betting'
    };
  }

  // Point is set
  game.point = roll.total;
  game.phase = 'point';

  return {
    message: `🎲 ${shooter.name} rolls... ${rollDisplay}

🎯 POINT IS ${game.point}! 🎯

${shooter.name} must roll ${game.point} again before rolling a 7!

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
 */
function resolveRound(game: GameState, shooterWins: boolean): string {
  const shooter = game.players.get(game.shooterUuid!)!;
  const lines: string[] = [];

  let shooterWinnings = 0;
  const winners: Player[] = [];
  const losers: Player[] = [];

  for (const [uuid, player] of game.players) {
    if (uuid === game.shooterUuid) continue;  // Handle shooter separately

    if (!player.bet || !player.betAmount) continue;

    const playerWins = (player.bet === 'pass' && shooterWins) || (player.bet === 'fade' && !shooterWins);

    if (playerWins) {
      player.points += player.betAmount;
      shooterWinnings -= player.betAmount;  // Shooter pays winners
      winners.push(player);
      lines.push(`✅ ${player.name}: +${player.betAmount} pts (${player.points} total)`);
    } else {
      player.points -= player.betAmount;
      shooterWinnings += player.betAmount;  // Shooter collects from losers
      losers.push(player);
      lines.push(`❌ ${player.name}: -${player.betAmount} pts (${player.points} total)`);
    }

    // Clear bet for next round
    player.bet = undefined;
    player.betAmount = undefined;
  }

  // Update shooter's points
  shooter.points += shooterWinnings;
  if (shooterWinnings >= 0) {
    lines.unshift(`🎯 ${shooter.name} (Shooter): +${shooterWinnings} pts (${shooter.points} total)`);
  } else {
    lines.unshift(`🎯 ${shooter.name} (Shooter): ${shooterWinnings} pts (${shooter.points} total)`);
  }

  // Rotate shooter if they lost
  if (!shooterWins) {
    rotateShooter(game);
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
      lines.push(`🏆 ${activePlayers[0].name} WINS THE GAME! 🏆`);
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
 * Check for eliminated players (0 or negative points)
 */
function checkEliminations(game: GameState): Player[] {
  const eliminated: Player[] = [];

  for (const [uuid, player] of game.players) {
    if (player.points <= 0) {
      eliminated.push(player);
      // Remove from shooter rotation
      const idx = game.shooterOrder.indexOf(uuid);
      if (idx !== -1) {
        game.shooterOrder.splice(idx, 1);
      }
    }
  }

  return eliminated;
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
