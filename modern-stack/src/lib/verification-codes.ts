import crypto from 'crypto';

/**
 * Signal Verification Code Management
 * Handles generation, storage, and validation of verification codes
 */

export interface VerificationCode {
  id: string;
  userId: string;
  phoneNumber: string;
  code: string;
  expiresAt: Date;
  attempts: number;
  verified: boolean;
  createdAt: Date;
}

/**
 * Generate a secure 6-digit verification code
 */
export function generateVerificationCode(): string {
  // Use crypto.randomInt for cryptographically secure random numbers
  const code = crypto.randomInt(100000, 999999);
  return code.toString();
}

/**
 * Generate a verification hash for secure storage
 * @param code The verification code
 * @param salt A unique salt (could be userId + timestamp)
 */
export function hashVerificationCode(code: string, salt: string): string {
  return crypto
    .createHash('sha256')
    .update(`${code}:${salt}`)
    .digest('hex');
}

/**
 * Verify a code against its hash
 */
export function verifyCode(inputCode: string, hashedCode: string, salt: string): boolean {
  const inputHash = hashVerificationCode(inputCode, salt);
  return crypto.timingSafeEqual(
    Buffer.from(inputHash),
    Buffer.from(hashedCode)
  );
}

/**
 * Check if a verification code has expired
 */
export function isCodeExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

/**
 * Create expiration date for verification code
 * @param minutes Minutes until expiration (default 10)
 */
export function createExpirationDate(minutes: number = 10): Date {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

/**
 * Format verification message for Signal
 */
export function formatVerificationMessage(code: string, appName: string = 'Community Dashboard'): string {
  return `Your ${appName} verification code is: ${code}\n\nThis code will expire in 10 minutes. Do not share this code with anyone.`;
}

/**
 * Validate phone number format for Signal
 */
export function validatePhoneNumber(phoneNumber: string): boolean {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Check if it's a valid phone number (basic validation)
  // Should be between 10-15 digits and start with country code
  return cleaned.length >= 10 && cleaned.length <= 15;
}

/**
 * Format phone number for Signal bridge
 */
export function formatPhoneForSignal(phoneNumber: string): string {
  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Add + prefix if not present
  if (!phoneNumber.startsWith('+')) {
    // Assume US number if 10 digits without country code
    if (cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }
    cleaned = '+' + cleaned;
  }
  
  return cleaned;
}