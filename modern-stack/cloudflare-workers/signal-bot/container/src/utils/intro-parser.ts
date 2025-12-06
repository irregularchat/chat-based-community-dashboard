/**
 * Intro Message Parser for Signal Bot
 *
 * Parses numbered introduction messages from new users.
 * Ported from dashboard's plugins/onboarding/index.js
 *
 * Expected format:
 * 1. Full name
 * 2. Organization
 * 3. Who invited you
 * 4. Email address
 * 5. Interests
 * 6. LinkedIn (optional, "skip" to skip)
 */

export interface ParsedIntro {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  organization?: string;
  invitedBy?: string;
  email?: string;
  interests?: string;
  linkedinUsername?: string;
  isValidIntro: boolean;
}

/**
 * Check if a message looks like a numbered introduction
 *
 * @param text - The message text to check
 * @returns true if message appears to be an intro
 */
export function isIntroMessage(text: string): boolean {
  if (!text) return false;

  const lines = text.split('\n').filter(l => l.trim());

  // Must have at least 4 lines (name, org, invited by, email)
  if (lines.length < 4) return false;

  // Check if first 3 lines start with a number
  const numberedPattern = /^\d+[\.\-\)\:\s]/;
  const firstThreeNumbered = lines.slice(0, 3).every(l => numberedPattern.test(l.trim()));

  return firstThreeNumbered;
}

/**
 * Parse an introduction message to extract user data
 *
 * @param text - The intro message text
 * @returns ParsedIntro object with extracted fields
 */
export function parseIntroduction(text: string): ParsedIntro {
  const result: ParsedIntro = {
    isValidIntro: false
  };

  if (!text) return result;

  // Split into lines and clean up
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length < 4) {
    return result;
  }

  // Regex to strip number prefixes: "1. ", "2) ", "3- ", "4: ", etc.
  const stripNumberPrefix = (line: string): string => {
    return line.replace(/^\d+[\.\:\-\)\(\]\[\}\{_\s\@]*\s*/, '').trim();
  };

  // Parse each line by position
  lines.forEach((line, index) => {
    const content = stripNumberPrefix(line);

    switch (index) {
      case 0: // Name
        const nameParts = content.split(' ').filter(p => p.length > 0);
        if (nameParts.length > 0) {
          result.firstName = nameParts[0];
          result.lastName = nameParts.slice(1).join(' ') || undefined;
          result.fullName = content;
        }
        break;

      case 1: // Organization
        result.organization = content;
        break;

      case 2: // Invited by
        result.invitedBy = content;
        break;

      case 3: // Email
        // Simple email validation - must contain @
        if (content.includes('@')) {
          // Extract email if there's extra text
          const emailMatch = content.match(/[\w.\-+]+@[\w.\-]+\.\w+/);
          result.email = emailMatch ? emailMatch[0] : content;
        }
        break;

      case 4: // Interests
        result.interests = content;
        break;

      case 5: // LinkedIn (optional)
        if (content.toLowerCase() !== 'skip' && content.length > 0) {
          result.linkedinUsername = content;
        }
        break;
    }
  });

  // Mark as valid if we have at least name and email
  result.isValidIntro = !!(result.firstName && result.email);

  return result;
}

/**
 * Extract email from text that might contain an intro or just an email
 *
 * @param text - Text to search for email
 * @returns email if found, undefined otherwise
 */
export function extractEmailFromText(text: string): string | undefined {
  if (!text) return undefined;

  // Look for email pattern
  const emailMatch = text.match(/[\w.\-+]+@[\w.\-]+\.\w+/);
  return emailMatch ? emailMatch[0] : undefined;
}

/**
 * Format parsed intro for logging
 */
export function formatIntroSummary(intro: ParsedIntro): string {
  const parts = [];
  if (intro.fullName) parts.push(`Name: ${intro.fullName}`);
  if (intro.email) parts.push(`Email: ${intro.email}`);
  if (intro.organization) parts.push(`Org: ${intro.organization}`);
  if (intro.invitedBy) parts.push(`Invited by: ${intro.invitedBy}`);
  return parts.join(' | ');
}
