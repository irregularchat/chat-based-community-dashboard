# Flexible Room Configuration Guide

This guide explains how to configure intelligent room recommendations for your community dashboard using a flexible, user-friendly environment variable system.

## Overview

The new flexible room recommendation system allows you to:
- Define custom categories that match your community's structure
- Configure rooms using simple environment variables
- Automatically match user interests to relevant rooms
- Control recommendation behavior and scoring
- Add new rooms and categories without code changes

## Quick Setup

1. **Copy environment template:**
   ```bash
   cp .env-template .env
   ```

2. **Edit room configurations in `.env`:**
   ```bash
   nano .env
   # Scroll to the "ROOM RECOMMENDATION CONFIGURATION" section
   ```

3. **Follow the 4-step configuration process in the template**

4. **Replace placeholder room IDs with your actual Matrix room IDs**

## 4-Step Configuration Process

The new system uses a simple 4-step process that makes it easy to customize for any community:

### Step 1: Define Categories

First, define the types of rooms your community has:

```env
CATEGORY_[UNIQUE_NAME] = Display Name|keyword1,keyword2,keyword3
```

**Examples:**
```env
CATEGORY_TECHNOLOGY = Technology|tech,programming,ai,cybersecurity,software
CATEGORY_SOCIAL = Social & General|social,chat,discussion,general,offtopic  
CATEGORY_HOBBIES = Hobbies & Interests|outdoor,gaming,music,art,sports
CATEGORY_PROFESSIONAL = Professional|business,career,work,finance
```

### Step 2: Define Rooms

Then, define your actual rooms using the categories from Step 1:

```env
ROOM_[UNIQUE_ID] = Room Name|Category Name(s)|Description|Matrix Room ID
```

**Examples:**
```env
ROOM_TECH_GENERAL = General Tech Chat|Technology|Tech discussions for all levels|!tech:yourdomain.com
ROOM_SOCIAL_MAIN = General Chat|Social & General|Off-topic community chat|!general:yourdomain.com
ROOM_HOBBIES_OUTDOOR = Outdoor Activities|Hobbies & Interests|Hiking and camping|!outdoor:yourdomain.com
```

### Step 3: Configure Behavior

Set recommendation behavior:

```env
ROOM_RECOMMENDATIONS_ENABLED = True
MAX_ROOM_RECOMMENDATIONS = 5
MIN_RECOMMENDATION_SCORE = 0.3
```

### Step 4: Add Keyword Expansions (Optional)

Add custom synonyms for better matching:

```env
INTEREST_KEYWORD_EXPANSIONS = ai:artificial intelligence,machine learning|cyber:cybersecurity,security,infosec
```

### Interest Keyword Expansions

Configure synonyms and related terms to improve matching:

```env
INTEREST_KEYWORD_EXPANSIONS = tech:technology,programming,coding,software|ai:artificial intelligence,machine learning,ml|security:cybersecurity,infosec,pentest,red team
```

**Format:** `keyword1:synonym1,synonym2,synonym3|keyword2:synonym1,synonym2`

### Recommendation Settings

```env
# Enable/disable recommendations
ROOM_RECOMMENDATIONS_ENABLED = True

# Maximum rooms to recommend per user
MAX_ROOM_RECOMMENDATIONS = 5

# Minimum match score required (0.0-1.0)
MIN_RECOMMENDATION_SCORE = 0.3
```

## Example Configuration

Here's a complete example based on the provided Signal groups:

### Tech Rooms
```env
ROOM_CONFIG_TECH = General Tech Lobby|Tech|General technology discussions and Q&A for all skill levels|!tech-general:matrix.domain.com;RF DragonChat|Tech,RF,EW|Electronic warfare, RF signals, SDR, and radio communications|!rf-dragonchat:matrix.domain.com;AI ML Chat|Tech,AI,ML|Artificial intelligence, machine learning, and data science discussions|!ai-ml-chat:matrix.domain.com;Unmanned Chat|Tech,Drones,Robotics|Drone technology, robotics, and unmanned systems|!unmanned-chat:matrix.domain.com;Purple Teaming|Tech,Security,Cybersecurity|Cybersecurity, red/blue/purple team operations and training|!purple-team:matrix.domain.com
```

### Information & Research Rooms
```env
ROOM_CONFIG_INFO = IWAR Chat|Information,Research,Influence|Information warfare, influence operations, and PSYOP discussions|!iwar-chat:matrix.domain.com;Research Chat|Information,Research,Academic|Academic research, analysis, and intelligence studies|!research-chat:matrix.domain.com
```

### Miscellaneous Rooms  
```env
ROOM_CONFIG_MISC = Off-Topic|Miscellaneous,General,Social|General conversations and off-topic discussions|!off-topic:matrix.domain.com;Outdoor Group|Miscellaneous,Outdoor,Adventure|Hiking, camping, outdoor activities and adventures|!outdoor-group:matrix.domain.com;Business Chat|Miscellaneous,Business,Career|Business discussions, entrepreneurship, and career advice|!business-chat:matrix.domain.com
```

### Location-Based Rooms
```env
ROOM_CONFIG_LOCATIONS = Fort Bragg NC|Location,FortBragg,NC|Local community for Fort Bragg, North Carolina area|!fort-bragg-nc:matrix.domain.com;National Capital Region|Location,NCR,DC|Washington DC and National Capital Region community|!ncr-group:matrix.domain.com;Tampa FL|Location,Tampa,FL|Tampa, Florida area community and meetups|!tampa-fl:matrix.domain.com
```

## How It Works

### 1. User Creates Account
When a user creates an account and enters interests like "cybersecurity, artificial intelligence"

### 2. Interest Expansion
The system expands interests using configured keywords:
- "cybersecurity" → "cybersecurity, infosec, pentest, red team, blue team"
- "artificial intelligence" → "ai, machine learning, ml, data science, neural networks"

### 3. Room Matching
Each configured room is scored based on matches between:
- User's expanded interests
- Room categories
- Room name  
- Room description

### 4. Filtering & Sorting
- Rooms with scores below `MIN_RECOMMENDATION_SCORE` are filtered out
- Remaining rooms are sorted by score (highest first)
- Top `MAX_ROOM_RECOMMENDATIONS` rooms are returned

### 5. User Selection
User sees recommended rooms with descriptions and can select which ones to join.

## Customization Tips

### Categories
Use consistent categories across rooms:
- **Tech**: General technology
- **Security**: Cybersecurity, infosec
- **AI**: Artificial intelligence, ML
- **Location**: Geographic regions
- **Business**: Professional topics
- **Social**: General conversation

### Descriptions
Write clear, welcoming descriptions:
- ✅ "General technology discussions and Q&A for all skill levels"
- ❌ "Tech stuff"

### Keywords
Include variations people might use:
- "ai" → "artificial intelligence, machine learning, ml, data science"
- "outdoor" → "hiking, camping, nature, adventure, outdoors"
- "security" → "cybersecurity, infosec, pentest, red team, blue team"

### Room IDs
Use your actual Matrix room IDs:
- Find them in your Matrix client (Room Settings → Advanced)
- Format: `!abc123:matrix.yourdomain.com`

## Testing Your Configuration

You can test your configuration by:

1. **Creating a test user** with specific interests
2. **Checking the logs** for recommendation matches
3. **Verifying room suggestions** match user interests
4. **Adjusting categories and keywords** as needed

## Performance Benefits

This configuration system provides:

- **⚡ Fast recommendations**: Uses environment variables instead of API calls
- **🎯 Better matching**: Configurable keyword expansions
- **📊 Scoring system**: Ranks rooms by relevance
- **⚙️ Flexible control**: Easy to adjust limits and behavior
- **🔧 Easy maintenance**: No code changes needed for room updates

## Migration from Old System

If you were using the old `MATRIX_ROOM_IDS_NAME_CATEGORY` format:

1. **Extract your existing room data**
2. **Convert to new format** with descriptions
3. **Add keyword expansions** for better matching
4. **Test with real user interests**
5. **Adjust categories** based on your community's needs

## Troubleshooting

### No rooms recommended
- Check `ROOM_RECOMMENDATIONS_ENABLED = True`
- Verify room IDs are correct
- Lower `MIN_RECOMMENDATION_SCORE`
- Add more keyword expansions

### Wrong rooms recommended  
- Review category assignments
- Add more specific keywords
- Adjust room descriptions
- Check for typos in interests

### Too many/few recommendations
- Adjust `MAX_ROOM_RECOMMENDATIONS`
- Modify `MIN_RECOMMENDATION_SCORE`
- Review keyword expansions

## Advanced Features

### Multiple Categories
Rooms can belong to multiple categories:
```
Purple Teaming|Tech,Security,Training|Description|!room:domain.com
```

### Smart Scoring
The system considers:
- Exact category matches (highest score)
- Name matches (medium score)  
- Description matches (lower score)
- Number of matching keywords

### Fallback Behavior
If configured rooms aren't available, the system falls back to:
1. Database cached rooms
2. Live Matrix API calls
3. Empty list (graceful degradation)

This ensures recommendations always work, even during Matrix connectivity issues.