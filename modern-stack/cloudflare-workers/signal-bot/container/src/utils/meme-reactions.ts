/**
 * Meme/GIF Reaction System for IrregularChat
 *
 * Provides contextual GIF reactions based on message keywords.
 * Designed to be subtle and not overused - reactions have cooldowns
 * and probability thresholds to avoid spamming the chat.
 */

import * as path from 'path';
import * as fs from 'fs/promises';

// Base path for meme files
const MEMES_DIR = process.env.MEMES_PATH || '/app/memes';

/**
 * Meme definition with trigger keywords and metadata
 */
export interface MemeDefinition {
  id: string;
  filename: string;
  description: string;
  triggers: string[];  // Keywords that can trigger this meme
  context?: string[];  // Optional context hints (argument, surprise, etc.)
  probability: number; // 0-1, chance of actually posting when triggered
  cooldownMinutes: number; // Minimum time between uses of this meme
}

/**
 * Event types that can trigger memes
 */
export type MemeEventType = 'member_join' | 'member_leave';

/**
 * Event-based meme definition (triggered by group events, not text)
 */
export interface EventMemeDefinition {
  id: string;
  filename: string;
  description: string;
  eventType: MemeEventType;
  targetGroupIds?: string[];  // Optional: only trigger in specific groups (by ID)
  targetGroupNames?: string[]; // Optional: only trigger in groups matching these names (substring match)
  probability: number;
  cooldownMinutes: number;
}

/**
 * Community meme library
 */
export const MEME_LIBRARY: MemeDefinition[] = [
  {
    id: 'sus_monkey',
    filename: 'sus_monkey.gif',
    description: 'Suspicious monkey side-eye',
    triggers: ['sus', 'suspicious', 'sketch', 'sketchy', 'doubt', 'hmm', 'hmmm'],
    context: ['doubt', 'suspicion'],
    probability: 0.3,
    cooldownMinutes: 30,
  },
  {
    id: 'watching_you',
    filename: 'watching_you.gif',
    description: 'Man watching from car',
    triggers: ['watching', 'see you', 'eyes on', 'monitoring', 'tracking'],
    context: ['surveillance', 'watching'],
    probability: 0.25,
    cooldownMinutes: 60,
  },
  {
    id: 'popcorn',
    filename: 'popcorn.gif',
    description: 'Michael Jackson eating popcorn',
    triggers: ['drama', 'argument', 'fight', 'debate', 'popcorn', 'this is getting good', 'spicy'],
    context: ['entertainment', 'drama'],
    probability: 0.4,
    cooldownMinutes: 45,
  },
  {
    id: 'gasp',
    filename: 'gasp.gif',
    description: 'Dramatic gasp reaction',
    triggers: ['gasp', 'omg', 'oh my god', 'shocking', 'no way', 'holy'],
    context: ['surprise', 'shock'],
    probability: 0.35,
    cooldownMinutes: 30,
  },
  {
    id: 'awkward',
    filename: 'awkward.gif',
    description: 'Awkward little girl in purple shirt',
    triggers: ['awkward', 'uncomfortable', 'cringe', 'yikes', 'oof', 'oops'],
    context: ['awkward', 'uncomfortable'],
    probability: 0.35,
    cooldownMinutes: 45,
  },
  {
    id: 'nodding',
    filename: 'nodding.gif',
    description: 'Guy on motorcycle nodding approvingly',
    triggers: ['agree', 'exactly', 'correct', 'this', 'truth', 'facts', 'based', 'respect'],
    context: ['agreement', 'approval'],
    probability: 0.3,
    cooldownMinutes: 60,
  },
  {
    id: 'hacker',
    filename: 'hacker.gif',
    description: 'Fake hacker on toy computer',
    triggers: ['hacker', 'hacking', 'cyber', 'im in', "i'm in", 'mainframe', 'firewall'],
    context: ['tech', 'hacking'],
    probability: 0.5,
    cooldownMinutes: 30,
  },
  {
    id: 'potato',
    filename: 'potato.gif',
    description: 'Potato will potate strange meme',
    triggers: ['potato', 'potatoes', 'tater', 'spud'],
    context: ['random', 'potato'],
    probability: 0.7,  // Higher chance for potato - it's a community thing
    cooldownMinutes: 20,
  },
  {
    id: 'arthur_fist',
    filename: 'arthur_fist.gif',
    description: 'Arthur clenched fist meme',
    triggers: ['barracks', 'barrack'],
    context: ['frustration', 'anger'],
    probability: 0.6,
    cooldownMinutes: 30,
  },
  {
    id: 'confused',
    filename: 'confused.gif',
    description: 'Confused math lady meme',
    triggers: ['confused', 'confusing', 'makes no sense', "don't understand", 'what does that mean'],
    context: ['confusion'],
    probability: 0.35,
    cooldownMinutes: 30,
  },
  {
    id: 'wtf_reaction',
    filename: 'wtf.gif',
    description: 'WTF reaction face',
    triggers: ['wtf', 'what the fuck', 'what the hell', 'wth'],
    context: ['shock', 'disbelief'],
    probability: 0.4,
    cooldownMinutes: 30,
  },
  {
    id: 'washington_leave',
    filename: 'washington_leave.gif',
    description: 'SNL George Washington dramatically leaving',
    triggers: ['im out', "i'm out", 'leaving', 'peace out', 'bye everyone', 'later losers'],
    context: ['departure', 'exit'],
    probability: 0.5,
    cooldownMinutes: 45,
  },
];

/**
 * Event-based meme library (triggered by group events like joins/leaves)
 */
export const EVENT_MEME_LIBRARY: EventMemeDefinition[] = [
  {
    id: 'washington_leave_event',
    filename: 'washington_leave.gif',
    description: 'SNL George Washington dramatically leaving - triggered when someone leaves',
    eventType: 'member_leave',
    probability: 0.6,
    cooldownMinutes: 30,
  },
  {
    id: 'meme_or_die',
    filename: 'meme_or_die.gif',
    description: 'Meme or die welcome meme for Off Topic Guild',
    eventType: 'member_join',
    targetGroupNames: ['Off Topic'],  // Matches "IR: Off Topic Guild"
    probability: 0.8,  // High probability - it's a welcome meme
    cooldownMinutes: 5, // Short cooldown so multiple people joining get welcomed
  },
];

// Track last use time for each meme (in-memory, resets on restart)
const memeLastUsed: Map<string, number> = new Map();

// Track last meme sent per group to avoid back-to-back memes
const groupLastMeme: Map<string, number> = new Map();
const GROUP_MEME_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between memes per group

/**
 * Check if a meme is on cooldown
 */
function isOnCooldown(meme: MemeDefinition): boolean {
  const lastUsed = memeLastUsed.get(meme.id);
  if (!lastUsed) return false;

  const cooldownMs = meme.cooldownMinutes * 60 * 1000;
  return Date.now() - lastUsed < cooldownMs;
}

/**
 * Check if group has had a recent meme
 */
function groupOnCooldown(groupId: string): boolean {
  const lastMeme = groupLastMeme.get(groupId);
  if (!lastMeme) return false;

  return Date.now() - lastMeme < GROUP_MEME_COOLDOWN_MS;
}

/**
 * Find memes that match the given message
 */
export function findMatchingMemes(message: string): MemeDefinition[] {
  const lowerMessage = message.toLowerCase();

  return MEME_LIBRARY.filter(meme => {
    return meme.triggers.some(trigger => {
      // Word boundary matching to avoid false positives
      const regex = new RegExp(`\\b${trigger}\\b`, 'i');
      return regex.test(lowerMessage);
    });
  });
}

/**
 * Select a meme to send based on message content
 * Returns null if no meme should be sent (cooldown, probability, etc.)
 */
export function selectMemeForMessage(
  message: string,
  groupId: string
): MemeDefinition | null {
  // Check group cooldown first
  if (groupOnCooldown(groupId)) {
    return null;
  }

  // Find matching memes
  const matches = findMatchingMemes(message);
  if (matches.length === 0) {
    return null;
  }

  // Filter out memes on cooldown
  const availableMemes = matches.filter(m => !isOnCooldown(m));
  if (availableMemes.length === 0) {
    return null;
  }

  // Sort by probability (higher probability = more likely)
  availableMemes.sort((a, b) => b.probability - a.probability);

  // Try each meme with its probability
  for (const meme of availableMemes) {
    if (Math.random() < meme.probability) {
      return meme;
    }
  }

  return null;
}

/**
 * Mark a meme as used (updates cooldown tracking)
 */
export function markMemeUsed(memeId: string, groupId: string): void {
  const now = Date.now();
  memeLastUsed.set(memeId, now);
  groupLastMeme.set(groupId, now);
}

/**
 * Get the file path for a meme
 */
export function getMemeFilePath(meme: MemeDefinition): string {
  return path.join(MEMES_DIR, meme.filename);
}

/**
 * Check if meme file exists
 */
export async function memeFileExists(meme: MemeDefinition): Promise<boolean> {
  try {
    await fs.access(getMemeFilePath(meme));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a random meme for !meme command
 */
export function getRandomMeme(): MemeDefinition {
  const index = Math.floor(Math.random() * MEME_LIBRARY.length);
  return MEME_LIBRARY[index];
}

/**
 * Get meme by ID
 */
export function getMemeById(id: string): MemeDefinition | undefined {
  return MEME_LIBRARY.find(m => m.id === id);
}

/**
 * List all available memes
 */
export function listMemes(): MemeDefinition[] {
  return [...MEME_LIBRARY];
}

/**
 * Get meme statistics
 */
export function getMemeStats(): {
  total: number;
  available: number;
  onCooldown: string[];
} {
  const onCooldown = MEME_LIBRARY
    .filter(m => isOnCooldown(m))
    .map(m => m.id);

  return {
    total: MEME_LIBRARY.length,
    available: MEME_LIBRARY.length - onCooldown.length,
    onCooldown,
  };
}

/**
 * Check if an event meme is on cooldown
 */
function isEventMemeOnCooldown(meme: EventMemeDefinition): boolean {
  const lastUsed = memeLastUsed.get(meme.id);
  if (!lastUsed) return false;

  const cooldownMs = meme.cooldownMinutes * 60 * 1000;
  return Date.now() - lastUsed < cooldownMs;
}

/**
 * Select an event-based meme for a group event
 * Returns null if no meme should be sent (cooldown, probability, no match, etc.)
 */
export function selectMemeForEvent(
  eventType: MemeEventType,
  groupId: string,
  groupName?: string
): EventMemeDefinition | null {
  // Check group cooldown
  if (groupOnCooldown(groupId)) {
    console.log(`🎭 [EVENT_MEME] Group ${groupId} on cooldown, skipping event meme`);
    return null;
  }

  // Find matching event memes
  const matches = EVENT_MEME_LIBRARY.filter(meme => {
    // Must match event type
    if (meme.eventType !== eventType) return false;

    // Check if on cooldown
    if (isEventMemeOnCooldown(meme)) return false;

    // Check group targeting
    if (meme.targetGroupIds && meme.targetGroupIds.length > 0) {
      if (!meme.targetGroupIds.includes(groupId)) return false;
    }

    if (meme.targetGroupNames && meme.targetGroupNames.length > 0 && groupName) {
      const lowerGroupName = groupName.toLowerCase();
      const matchesName = meme.targetGroupNames.some(targetName =>
        lowerGroupName.includes(targetName.toLowerCase())
      );
      if (!matchesName) return false;
    }

    return true;
  });

  if (matches.length === 0) {
    console.log(`🎭 [EVENT_MEME] No matching memes for event ${eventType} in group ${groupName || groupId}`);
    return null;
  }

  // Sort by probability (higher = more likely)
  matches.sort((a, b) => b.probability - a.probability);

  // Try each meme with its probability
  for (const meme of matches) {
    if (Math.random() < meme.probability) {
      console.log(`🎭 [EVENT_MEME] Selected ${meme.id} for ${eventType} event in ${groupName || groupId}`);
      return meme;
    }
  }

  console.log(`🎭 [EVENT_MEME] Probability check failed for all ${matches.length} matching memes`);
  return null;
}

/**
 * Mark an event meme as used (updates cooldown tracking)
 */
export function markEventMemeUsed(memeId: string, groupId: string): void {
  const now = Date.now();
  memeLastUsed.set(memeId, now);
  groupLastMeme.set(groupId, now);
}

/**
 * Get file path for an event meme
 */
export function getEventMemeFilePath(meme: EventMemeDefinition): string {
  return path.join(MEMES_DIR, meme.filename);
}
