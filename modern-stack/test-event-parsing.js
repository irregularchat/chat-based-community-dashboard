// Test the improved event parsing logic
const testEventDescription = `Counter Unmanned Aerial System (C-UAS) Technology & Federal Law/Drone Vulnerability & Risk Assessment (DVRA) Course Mon Oct 20, 2025 9:00 AM - Fri Oct 24, 2025 5:00 PM MDT
ENSCO Colorado Springs, 80916 https://www.tickettailor.com/events/enscoinc/1792120`;

function basicEventParsing(description) {
  // Enhanced regex-based parsing with better natural language understanding
  const parsed = {
    name: null,
    start: null,
    end: null,
    location: null,
    timezone: 'America/New_York',
    description: description
  };
  
  // Split the description into lines for multi-line parsing
  const lines = description.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const fullText = lines.join(' ');
  
  // Enhanced date/time patterns to handle more formats
  const datePatterns = [
    // Mon Oct 20, 2025 format
    /(?:mon|tue|wed|thu|fri|sat|sun)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/i,
    // Oct 20, 2025 format  
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/i,
    // Other existing patterns
    /(?:on |at )?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?)/i,
    /(?:on |at )?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
    /(tomorrow|today|tonight|next \w+day|this \w+day)/i
  ];
  
  const timePatterns = [
    // Enhanced time patterns
    /(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)(?:\s*-\s*\d{1,2}:\d{2}\s*(?:am|pm|AM|PM))?(?:\s+[A-Z]{2,4})?)/i,
    /(?:at |from )?(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i,
    /(?:at |from )?(\d{1,2}:\d{2})/
  ];
  
  // Try to find a date
  for (const pattern of datePatterns) {
    const match = fullText.match(pattern);
    if (match) {
      parsed.start = match[0]; // Use the full match for better date extraction
      break;
    }
  }
  
  // Try to find a time - if not found, default to a reasonable time
  let foundTime = false;
  for (const pattern of timePatterns) {
    const match = fullText.match(pattern);
    if (match) {
      if (parsed.start) {
        parsed.start = parsed.start + ' ' + match[1];
      } else {
        parsed.start = match[1];
      }
      foundTime = true;
      break;
    }
  }
  
  // If no time specified, add a default evening time for meetups
  if (parsed.start && !foundTime) {
    parsed.start += ' 6:00 PM'; // Default to 6 PM for community events
  }
  
  // Enhanced location extraction
  let foundLocation = null;
  
  // Try to extract location from separate lines (like "ENSCO Colorado Springs, 80916")
  for (const line of lines) {
    // Skip lines that are clearly URLs
    if (line.includes('http') || line.includes('www.')) continue;
    
    // Look for patterns that suggest location (company name + city, state, zip)
    const locationPatterns = [
      // Company/venue name with city, state, zip
      /^([A-Za-z0-9\s&.-]+)\s+([A-Za-z\s]+),\s*(\d{5})/,
      // Address with city, state, zip  
      /(\d+\s+[A-Za-z0-9\s,.-]+,\s*[A-Za-z\s]+,?\s*\d{5})/,
      // City, State ZIP
      /([A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5})/,
      // Simple city, state
      /([A-Za-z\s]+,\s*[A-Z]{2})/
    ];
    
    for (const pattern of locationPatterns) {
      const match = line.match(pattern);
      if (match) {
        foundLocation = match[0].trim();
        break;
      }
    }
    if (foundLocation) break;
  }
  
  // Fallback to traditional "at location" patterns
  if (!foundLocation) {
    const atLocationMatch = fullText.match(/\bat\s+([^,]+?)(?:\s+on\s+|\s*$)/i);
    if (atLocationMatch && !atLocationMatch[1].match(/^\d/)) { // Avoid matching times
      foundLocation = atLocationMatch[1].trim();
    } else {
      // Look for street addresses (numbers followed by street names)
      const addressMatch = fullText.match(/(\d+\s+\w+\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|place|pl|way))\b/i);
      if (addressMatch) {
        foundLocation = addressMatch[1].trim();
      }
    }
  }
  
  parsed.location = foundLocation;
  
  // Enhanced event name extraction with context understanding
  let eventName = null;
  
  // For complex event descriptions, try to extract the main title before date/time
  // Look for text before dates like "Mon Oct 20, 2025"
  const beforeDateMatch = fullText.match(/^(.+?)\s+(?:mon|tue|wed|thu|fri|sat|sun)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (beforeDateMatch) {
    let candidate = beforeDateMatch[1].trim();
    // Remove common trailing words that might be part of date description
    candidate = candidate.replace(/\s+(course|event|class|workshop|training|seminar)\s*$/i, ' $1');
    if (candidate && candidate.length > 10) { // Ensure it's substantial
      eventName = candidate;
    }
  }
  
  // Clean up and format the event name
  if (eventName) {
    // Keep original case for technical terms and acronyms
    parsed.name = eventName.trim();
  } else {
    // Generate a contextual default name
    parsed.name = "Community Meetup";
  }
  
  return parsed;
}

// Test the parsing
console.log('Testing event parsing...\n');
console.log('Input:', testEventDescription);
console.log('\nParsed result:');
const result = basicEventParsing(testEventDescription);
console.log(JSON.stringify(result, null, 2));