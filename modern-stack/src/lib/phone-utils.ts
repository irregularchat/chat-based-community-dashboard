/**
 * Phone number normalization and validation utilities
 * Based on legacy Streamlit implementation
 */

import { parsePhoneNumber } from 'libphonenumber-js';

export interface NormalizedPhone {
  normalized: string;
  isValid: boolean;
  country?: string;
  error?: string;
}

/**
 * Normalize a phone number, adding +1 if missing country code unless it appears to be from another country
 * @param phoneNumber - Raw phone number input
 * @returns Normalized phone number object
 */
export function normalizePhoneNumber(phoneNumber: string): NormalizedPhone {
  if (!phoneNumber || !phoneNumber.trim()) {
    return {
      normalized: '',
      isValid: false,
      error: 'Phone number cannot be empty'
    };
  }

  // Clean the input - remove whitespace and common separators
  const cleaned = phoneNumber.trim().replace(/[\s\-\(\)\[\]\{\}]/g, '');
  
  // If it already starts with +, try to parse as-is
  if (cleaned.startsWith('+')) {
    try {
      const parsed = parsePhoneNumber(cleaned);
      if (parsed && parsed.isValid()) {
        return {
          normalized: parsed.format('E.164'),
          isValid: true,
          country: parsed.country
        };
      }
    } catch (_error) {
      return {
        normalized: cleaned,
        isValid: false,
        error: 'Invalid phone number format'
      };
    }
  }

  // Check if it contains only digits
  const digitMatch = cleaned.match(/^\d+$/);
  if (!digitMatch) {
    return {
      normalized: cleaned,
      isValid: false,
      error: 'Phone number should contain only digits and country code'
    };
  }

  const digitsOnly = cleaned;
  
  // If it's 10 digits, assume US and add +1
  if (digitsOnly.length === 10) {
    const withCountryCode = `+1${digitsOnly}`;
    try {
      const parsed = parsePhoneNumber(withCountryCode);
      if (parsed && parsed.isValid()) {
        return {
          normalized: parsed.format('E.164'),
          isValid: true,
          country: parsed.country
        };
      }
    } catch (_error) {
      // If US parsing fails, continue to international logic
    }
  }

  // If it's 11 digits and starts with 1, assume US
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    const withPlus = `+${digitsOnly}`;
    try {
      const parsed = parsePhoneNumber(withPlus);
      if (parsed && parsed.isValid()) {
        return {
          normalized: parsed.format('E.164'),
          isValid: true,
          country: parsed.country
        };
      }
    } catch (_error) {
      // If US parsing fails, continue to international logic
    }
  }

  // For other lengths, try common country codes (excluding US since we handled it above)
  const commonCountryCodes = [
    { code: '44', name: 'UK', length: [10, 11] },
    { code: '49', name: 'Germany', length: [10, 11, 12] },
    { code: '33', name: 'France', length: [9, 10] },
    { code: '39', name: 'Italy', length: [9, 10, 11] },
    { code: '34', name: 'Spain', length: [9] },
    { code: '31', name: 'Netherlands', length: [9] },
    { code: '32', name: 'Belgium', length: [8, 9] },
    { code: '41', name: 'Switzerland', length: [9] },
    { code: '43', name: 'Austria', length: [10, 11] },
    { code: '45', name: 'Denmark', length: [8] },
    { code: '46', name: 'Sweden', length: [8, 9] },
    { code: '47', name: 'Norway', length: [8] },
    { code: '358', name: 'Finland', length: [8, 9] },
    { code: '61', name: 'Australia', length: [9] },
    { code: '81', name: 'Japan', length: [10, 11] },
    { code: '86', name: 'China', length: [11] },
    { code: '91', name: 'India', length: [10] },
    { code: '55', name: 'Brazil', length: [10, 11] }
  ];

  // Try to match against known country patterns only if US didn't work
  if (digitsOnly.length !== 10 && !(digitsOnly.length === 11 && digitsOnly.startsWith('1'))) {
    for (const country of commonCountryCodes) {
      if (country.length.includes(digitsOnly.length)) {
        const withCountryCode = `+${country.code}${digitsOnly}`;
        try {
          const parsed = parsePhoneNumber(withCountryCode);
          if (parsed && parsed.isValid()) {
            return {
              normalized: parsed.format('E.164'),
              isValid: true,
              country: parsed.country
            };
          }
        } catch (_error) {
          // Continue to next country
        }
      }
    }
  }

  // If no country code worked, return error
  return {
    normalized: cleaned,
    isValid: false,
    error: `Unsupported phone number format. Please include country code or use a valid US number (10 digits).`
  };
}

/**
 * Validate a phone number using the Signal identity validation logic from legacy code
 * @param signalIdentity - Signal identity (phone number or username)
 * @returns Validation result
 */
export function validateSignalIdentity(signalIdentity: string): { isValid: boolean; error?: string } {
  if (!signalIdentity || !signalIdentity.trim()) {
    return { isValid: false, error: 'Signal identity cannot be empty' };
  }

  const cleaned = signalIdentity.trim();
  
  // Check if it's a phone number (simple validation from legacy code)
  const phonePattern = /^\+?[0-9]{10,15}$/;
  
  if (phonePattern.test(cleaned)) {
    // If it looks like a phone number, validate it more strictly
    if (!cleaned.startsWith('+')) {
      return { isValid: false, error: 'Phone numbers should include country code (e.g., +1234567890)' };
    }
    
    // Use our normalization function for further validation
    const normalized = normalizePhoneNumber(cleaned);
    if (!normalized.isValid) {
      return { isValid: false, error: normalized.error };
    }
    
    return { isValid: true };
  }
  
  // If it's not a phone number, it should be at least 3 characters long (username)
  if (cleaned.length < 3) {
    return { isValid: false, error: 'Signal name should be at least 3 characters long' };
  }
  
  return { isValid: true };
}

/**
 * Format phone number for display
 * @param phoneNumber - E.164 formatted phone number
 * @returns Human readable format
 */
export function formatPhoneForDisplay(phoneNumber: string): string {
  try {
    const parsed = parsePhoneNumber(phoneNumber);
    if (parsed) {
      return parsed.formatInternational();
    }
  } catch (_error) {
    // Fall back to raw number
  }
  return phoneNumber;
} 