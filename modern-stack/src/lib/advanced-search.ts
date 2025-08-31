export interface SearchToken {
  type: 'field' | 'value' | 'operator' | 'group';
  field?: string;
  value: string;
  operator?: 'AND' | 'OR' | 'NOT';
  children?: SearchToken[];
}

export interface SearchCondition {
  field?: string;
  value: string;
  operator: 'contains' | 'equals' | 'not_contains' | 'not_equals';
  mode?: 'insensitive' | 'sensitive';
}

export interface ParsedSearch {
  conditions: SearchCondition[];
  logic: 'AND' | 'OR';
  isAdvanced: boolean;
}

// Supported search fields for users
export const USER_SEARCH_FIELDS = {
  'user': 'username',
  'username': 'username',
  'email': 'email',
  'name': ['firstName', 'lastName'],
  'firstname': 'firstName',
  'lastname': 'lastName',
  'first': 'firstName',
  'last': 'lastName',
  'active': 'isActive',
  'admin': 'isAdmin',
  'moderator': 'isModerator',
  'role': ['isAdmin', 'isModerator'],
} as const;

/**
 * Tokenize the search query
 */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < query.length; i++) {
    const char = query[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      quoteChar = '';
    } else if (!inQuotes && char === ' ') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else if (!inQuotes && (char === '(' || char === ')')) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      tokens.push(char);
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens.filter(t => t.length > 0);
}

/**
 * Parse field:value syntax
 */
function parseFieldValue(token: string): { field?: string; value: string } {
  const colonIndex = token.indexOf(':');
  if (colonIndex === -1 || colonIndex === 0 || colonIndex === token.length - 1) {
    return { value: token };
  }

  const field = token.substring(0, colonIndex).toLowerCase();
  const value = token.substring(colonIndex + 1);

  // Validate field
  if (field in USER_SEARCH_FIELDS) {
    return { field, value };
  }

  // If field is not recognized, treat the whole thing as a value
  return { value: token };
}

/**
 * Check if a token is a boolean operator
 */
function isOperator(token: string): token is 'AND' | 'OR' | 'NOT' {
  const upperToken = token.toUpperCase();
  return upperToken === 'AND' || upperToken === 'OR' || upperToken === 'NOT';
}

/**
 * Convert parsed tokens to Prisma where conditions
 */
function buildPrismaConditions(tokens: SearchToken[]): Record<string, unknown> {
  if (tokens.length === 0) return {};

  const conditions: Record<string, unknown>[] = [];
  let currentLogic: 'AND' | 'OR' = 'AND';
  let isNegated = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'operator') {
      if (token.operator === 'NOT') {
        isNegated = true;
        continue;
      } else if (token.operator) {
        currentLogic = token.operator;
        continue;
      }
    }

    if (token.type === 'field' || token.type === 'value') {
      const condition = buildFieldCondition(token, isNegated);
      if (condition) {
        conditions.push(condition);
      }
      isNegated = false;
    }
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];

  return currentLogic === 'OR' ? { OR: conditions } : { AND: conditions };
}

/**
 * Build a condition for a specific field
 */
function buildFieldCondition(token: SearchToken, isNegated: boolean = false): Record<string, unknown> {
  const { field, value } = token;

  if (!field) {
    // No field specified, search across all text fields
    const textSearchConditions = [
      { username: { contains: value, mode: 'insensitive' } },
      { email: { contains: value, mode: 'insensitive' } },
      { firstName: { contains: value, mode: 'insensitive' } },
      { lastName: { contains: value, mode: 'insensitive' } },
    ];

    const condition = { OR: textSearchConditions };
    return isNegated ? { NOT: condition } : condition;
  }

  // Handle field-specific searches
  const mappedFields = USER_SEARCH_FIELDS[field as keyof typeof USER_SEARCH_FIELDS];
  
  if (!mappedFields) {
    return null;
  }

  if (Array.isArray(mappedFields)) {
    // Multiple fields (e.g., name -> firstName, lastName)
    const fieldConditions = mappedFields.map(fieldName => {
      if (fieldName === 'isActive' || fieldName === 'isAdmin' || fieldName === 'isModerator') {
        // Boolean fields
        const boolValue = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes';
        return { [fieldName]: boolValue };
      } else {
        // Text fields
        return { [fieldName]: { contains: value, mode: 'insensitive' } };
      }
    });

    const condition = { OR: fieldConditions };
    return isNegated ? { NOT: condition } : condition;
  } else {
    // Single field
    const fieldName = mappedFields as string;
    let fieldCondition: Record<string, unknown>;

    if (fieldName === 'isActive' || fieldName === 'isAdmin' || fieldName === 'isModerator') {
      // Boolean fields
      const boolValue = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes';
      fieldCondition = { [fieldName]: boolValue };
    } else {
      // Text fields
      fieldCondition = { [fieldName]: { contains: value, mode: 'insensitive' } };
    }

    return isNegated ? { NOT: fieldCondition } : fieldCondition;
  }
}

/**
 * Main function to parse advanced search query
 */
export function parseAdvancedSearch(query: string): { where: Record<string, unknown>; isAdvanced: boolean } {
  if (!query || query.trim() === '') {
    return { where: {}, isAdvanced: false };
  }

  const trimmedQuery = query.trim();
  
  // Check if this is an advanced search (contains operators or field:value syntax)
  const isAdvanced = /(\s+(AND|OR|NOT)\s+|:|\(|\)|"|')/.test(trimmedQuery);

  if (!isAdvanced) {
    // Simple search - search across all text fields
    return {
      where: {
        OR: [
          { username: { contains: trimmedQuery, mode: 'insensitive' } },
          { email: { contains: trimmedQuery, mode: 'insensitive' } },
          { firstName: { contains: trimmedQuery, mode: 'insensitive' } },
          { lastName: { contains: trimmedQuery, mode: 'insensitive' } },
        ],
      },
      isAdvanced: false,
    };
  }

  // Parse advanced search
  const tokens = tokenize(trimmedQuery);
  const searchTokens: SearchToken[] = [];
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (isOperator(token)) {
      searchTokens.push({
        type: 'operator',
        value: token,
        operator: token.toUpperCase() as 'AND' | 'OR' | 'NOT',
      });
    } else if (token === '(' || token === ')') {
      // For now, ignore grouping - could be enhanced later
      continue;
    } else {
      const { field, value } = parseFieldValue(token);
      searchTokens.push({
        type: field ? 'field' : 'value',
        field,
        value,
      });
    }
  }

  const where = buildPrismaConditions(searchTokens);
  
  return { where, isAdvanced: true };
}

/**
 * Helper function to get search suggestions
 */
export function getSearchSuggestions(): string[] {
  return [
    'user:john',
    'email:gmail.com',
    'name:smith',
    'active:true',
    'admin:true',
    'moderator:false',
    'gmail OR irregularchat',
    'user:admin AND active:true',
    'email:gmail.com NOT user:test',
    '"John Smith"',
    'firstname:john lastname:doe',
  ];
}

/**
 * Helper function to get field descriptions
 */
export function getFieldDescriptions(): Record<string, string> {
  return {
    'user/username': 'Search by username',
    'email': 'Search by email address or domain',
    'name': 'Search by first or last name',
    'firstname/first': 'Search by first name only',
    'lastname/last': 'Search by last name only',
    'active': 'Filter by active status (true/false)',
    'admin': 'Filter by admin role (true/false)',
    'moderator': 'Filter by moderator role (true/false)',
    'role': 'Search by admin or moderator roles',
  };
} 