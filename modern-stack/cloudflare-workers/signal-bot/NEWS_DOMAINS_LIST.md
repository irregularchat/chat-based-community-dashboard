# News Domains - Complete List

## Total: 200+ Domains

### Major Categories

#### 1. Major News Networks (25 domains)
CNN, BBC, NYTimes, Washington Post, Reuters, AP News, Fox News, NPR, Guardian, MSNBC, Newsweek, Time, USA Today, etc.

#### 2. Military & Defense (20 domains)
- **Military Times Family**: militarytimes.com, armytimes.com, navytimes.com, airforcetimes.com, marinecorpstimes.com
- **Defense Publications**: defensenews.com, defenseone.com, breakingdefense.com, c4isrnet.com
- **Military News**: military.com, stripes.com, sofrep.com, taskandpurpose.com
- **Defense Analysis**: janes.com, nationaldefensemagazine.org, thedrive.com/the-war-zone
- **Veteran Media**: wearethemighty.com, sandboxx.us, coffeeordie.com

#### 3. Intelligence & Security (15 domains)
- **Government**: cia.gov, nsa.gov, fbi.gov, dhs.gov, cisa.gov, intelligence.senate.gov
- **Security News**: cyberscoop.com, recordedfuture.com, bellingcat.com
- **Cybersecurity**: thehackernews.com, krebsonsecurity.com, darkreading.com, bleepingcomputer.com, securityweek.com, threatpost.com

#### 4. Substack & Newsletters (15+ domains)
- **Platforms**: substack.com, newsletter.substack.com, beehiiv.com, ghost.org, buttondown.email, revue.co
- **Notable Authors**:
  - mattyglez.substack.com (Matt Yglesias)
  - thedispatch.com (The Dispatch)
  - bariweiss.substack.com (Bari Weiss)
  - matttaibbi.substack.com (Matt Taibbi)
  - glenngreenwaldsubstack.com (Glenn Greenwald)
  - astralcodexten.substack.com (Scott Alexander)
  - slowboring.com (Matt Yglesias)
  - noahpinion.substack.com (Noah Smith)
  - popularinfo.substack.com (Judd Legum)
  - heathercoxrichardson.substack.com (Heather Cox Richardson)

#### 5. Business & Finance (16 domains)
Bloomberg, Forbes, Fortune, CNBC, Business Insider, Wall Street Journal, Financial Times, MarketWatch, Barron's, Benzinga, Morningstar, Investor's Business Daily, Zacks

#### 6. Technology (18 domains)
TechCrunch, Ars Technica, The Verge, Wired, Engadget, Gizmodo, CNET, ZDNet, Hackaday, Tom's Hardware, AnandTech, 9to5Mac, MacRumors, Android Police, XDA Developers

#### 7. International News (22 domains)
Al Jazeera, DW, France24, RT, SCMP, Japan Times, CBC, Globe and Mail, ABC Australia, SBS, NZ Herald, Straits Times, Channel News Asia, The Times UK, Euronews, various "The Local" sites

#### 8. Science & Health (20 domains)
Nature, Science Magazine, New Scientist, National Geographic, Scientific American, NIH, CDC, WHO, The Lancet, NEJM, BMJ, PNAS, Cell, Space.com, Phys.org, ScienceDaily, STAT News, Healthline

#### 9. Climate & Environment (9 domains)
Inside Climate News, Climate Central, Carbon Brief, Yale Climate Connections, Grist, Earther, E&E News, Yale Environment 360, DeSmog

#### 10. Regional/Local News (18 domains)
Seattle Times, LA Times, Chicago Tribune, Boston Globe, Miami Herald, Atlanta Journal-Constitution, Philadelphia Inquirer, Detroit News, Dallas News, Houston Chronicle, Denver Post, and more

#### 11. Alternative & Independent (17 domains)
ProPublica, The Intercept, Mother Jones, The Nation, The Atlantic, New Yorker, Harper's, New Republic, Slate, Salon, HuffPost, Daily Beast, Reason, Jacobin, Current Affairs, CounterPunch, Common Dreams

#### 12. Investigative Journalism (13 domains)
ProPublica, Reveal News, Center for Public Integrity, OpenSecrets, ICIJ, Marshall Project, Bureau of Investigative Journalism, New America, Brookings

#### 13. Think Tanks & Policy (9 domains)
RAND, Council on Foreign Relations, CSIS, Heritage Foundation, AEI, Urban Institute, Pew Research, Brennan Center, ACLU

#### 14. Legal & Courts (7 domains)
SCOTUSblog, Lawfare, Justia, Law.com, ABA Journal, Courthouse News, SupremeCourt.gov

#### 15. Energy & Resources (6 domains)
OilPrice, Energy Central, Renewable Energy World, GreenTech Media, Utility Dive, Power Magazine

#### 16. Transportation & Aerospace (7 domains)
Flight Global, Aviation Week, AOPA, NASA, Space News, Spaceflight Now, NASA Spaceflight

#### 17. Media Industry (12 domains)
Nieman Lab, Columbia Journalism Review, Poynter, AdWeek, Ad Age, Variety, Hollywood Reporter, Deadline, TVLine, Entertainment Weekly, AV Club

#### 18. Sports (13 domains)
ESPN, Sports Illustrated, Bleacher Report, The Ringer, The Athletic, CBS Sports, Fox Sports, Sporting News, NFL.com, NBA.com, MLB.com, NHL.com

#### 19. Crypto & Blockchain (7 domains)
CoinDesk, Cointelegraph, Decrypt, The Block, Coinbase Blog, Bitcoin.com, CryptoSlate

#### 20. General Platforms (6 domains)
Medium, WordPress, Blogger, Tumblr, LinkedIn Pulse, Quora

## Special Features

### Subdomain Support
The detector automatically handles subdomains. For example:
- `blog.cnn.com` → Detected as CNN
- `anyname.substack.com` → Detected as Substack
- `www.nytimes.com` → Detected as NYTimes

### Path-Based Detection
Some domains include specific paths:
- `thedrive.com/the-war-zone` → War Zone section
- `yahoo.com/finance` → Finance section
- `zdnet.com/security` → Security section

## Usage

When any URL from these domains is posted in Signal:
1. Bot automatically detects it as news content
2. Sends acknowledgment: "📰 News article detected from {domain}. Processing..."
3. Attempts to scrape and summarize (Worker endpoint required)
4. Optionally posts to Discourse forum

## Adding More Domains

To add new domains, edit:
```
container/src/utils/news-detector.ts
```

Add to the `NEWS_DOMAINS` array in the appropriate category section.

## Testing

Test various domains:
```
https://www.cnn.com/...           → Major news
https://militarytimes.com/...     → Military news
https://example.substack.com/...  → Substack
https://defensenews.com/...       → Defense
https://bellingcat.com/...        → Investigative
https://spacenews.com/...         → Aerospace
```

All should trigger: "📰 News article detected from {domain}..."
