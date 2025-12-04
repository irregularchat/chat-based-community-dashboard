/**
 * News Domain Detection Utility
 * Salvaged from /modern-stack/archive/experimental/remote-scraper-plugin.js
 *
 * UPDATED: Now uses an exclusion-based approach instead of whitelist.
 * Archives any URL that is NOT:
 * - Social media (Instagram, TikTok, Twitter, YouTube, etc.)
 * - Community sites (irregularpedia.org, irregularchat.com, irregular.chat)
 * - File hosting/CDNs
 */

// Community domains to skip processing (our own sites)
export const COMMUNITY_DOMAINS = [
  'irregularpedia.org',
  'irregularchat.com',
  'irregular.chat',
  'forum.irregularchat.com',
];

// Social media domains to skip (handled by social media detector)
export const SOCIAL_MEDIA_DOMAINS = [
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'fb.com',
  'reddit.com',
  'vimeo.com',
  'twitch.tv',
  'linkedin.com',
  'pinterest.com',
  'snapchat.com',
  'threads.net',
  'discord.com',
  'discord.gg',
  'telegram.org',
  't.me',
  'whatsapp.com',
  'signal.org',
];

// File hosting and CDN domains to skip
export const FILE_HOSTING_DOMAINS = [
  'pcloud.com',
  'pcloud.link',
  'dropbox.com',
  'drive.google.com',
  'docs.google.com',
  'onedrive.live.com',
  'icloud.com',
  'mega.nz',
  'mediafire.com',
  'wetransfer.com',
  'box.com',
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'imgur.com',
  'giphy.com',
  'tenor.com',
  'gfycat.com',
  'streamable.com',
];

// Comprehensive news domains for auto-detection (kept for reference/backwards compatibility)
export const NEWS_DOMAINS = [
  // Major News Networks
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com', 'economist.com',
  'reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'foxnews.com',
  'npr.org', 'guardian.com', 'theguardian.com', 'independent.co.uk', 'telegraph.co.uk',
  'usatoday.com', 'abcnews.go.com', 'cbsnews.com', 'nbcnews.com',
  'pbs.org', 'axios.com', 'politico.com', 'thehill.com', 'vox.com',
  'msnbc.com', 'newsweek.com', 'time.com', 'latimes.com', 'nypost.com',
  'chicagotribune.com', 'bostonglobe.com', 'sfchronicle.com', 'mercurynews.com',
  'washingtontimes.com', 'washingtonexaminer.com', 'kqed.org',

  // Business & Finance
  'bloomberg.com', 'forbes.com', 'fortune.com', 'marketwatch.com',
  'cnbc.com', 'businessinsider.com', 'barrons.com', 'fool.com',
  'seekingalpha.com', 'thestreet.com', 'benzinga.com', 'investing.com',
  'yahoo.com/finance', 'morningstar.com', 'investors.com', 'zacks.com',

  // Technology
  'techcrunch.com', 'arstechnica.com', 'theverge.com', 'wired.com',
  'engadget.com', 'gizmodo.com', 'zdnet.com', 'cnet.com', 'mashable.com',
  'recode.net', 'venturebeat.com', 'theinformation.com', 'protocol.com',
  'hackaday.com', 'tomshardware.com', 'anandtech.com', '9to5mac.com',
  'macrumors.com', 'androidpolice.com', 'xda-developers.com',
  'docling.ai', 'towardsdatascience.com', 'kdnuggets.com',

  // AI & Machine Learning
  'openai.com/blog', 'anthropic.com', 'deepmind.com', 'huggingface.co',
  'ai.google', 'ai.meta.com', 'nvidia.com/blog', 'arxiv.org',

  // Academic & Research
  'ieeexplore.ieee.org', 'acm.org', 'sciencedirect.com', 'springer.com',
  'researchgate.net', 'academia.edu', 'scholar.google.com',

  // Military & Defense
  'military.com', 'militarytimes.com', 'defense.gov', 'defenseone.com',
  'breakingdefense.com', 'c4isrnet.com', 'defensenews.com', 'armytimes.com',
  'navytimes.com', 'airforcetimes.com', 'marinecorpstimes.com',
  'stripes.com', 'nationaldefensemagazine.org', 'janes.com',
  'thedrive.com/the-war-zone', 'thedrive.com', 'sofrep.com', 'taskandpurpose.com',
  'wearethemighty.com', 'sandboxx.us', 'coffeeordie.com',
  'defenceweb.co.za', 'defensescoop.com', 'nationalinterest.org',
  'warisboring.com', 'armyrecognition.com', 'navalnews.com',
  'airforcemag.com', 'realcleardefense.com', 'irregularpedia.org',

  // Government & Procurement
  'sam.gov', 'govexec.com', 'federalnewsnetwork.com', 'nextgov.com',
  'fcw.com', 'gcn.com', 'meritalk.com', 'fedscoop.com',

  // Intelligence & Security
  'intelligence.senate.gov', 'cia.gov', 'nsa.gov', 'fbi.gov',
  'dhs.gov', 'cisa.gov', 'cyberscoop.com', 'recordedfuture.com',
  'bellingcat.com', 'securityaffairs.com', 'thehackernews.com',
  'krebsonsecurity.com', 'darkreading.com', 'bleepingcomputer.com',
  'securityweek.com', 'threatpost.com', 'zdnet.com/security',

  // International
  'aljazeera.com', 'dw.com', 'france24.com', 'rt.com', 'sputniknews.com',
  'scmp.com', 'japantimes.co.jp', 'theage.com.au', 'smh.com.au',
  'stuff.co.nz', 'cbc.ca', 'globeandmail.com', 'thestar.com',
  'sbs.com.au', 'abc.net.au', 'nzherald.co.nz', 'straitstimes.com',
  'channelnewsasia.com', 'thetimes.co.uk', 'independent.ie',
  'thelocal.se', 'thelocal.de', 'thelocal.fr', 'euronews.com',

  // Alternative & Independent
  'propublica.org', 'intercept.com', 'motherjones.com', 'thenation.com',
  'theatlantic.com', 'newyorker.com', 'harpers.org', 'newrepublic.com',
  'slate.com', 'salon.com', 'huffpost.com', 'dailybeast.com',
  'reason.com', 'jacobin.com', 'currentaffairs.org', 'counterpunch.org',
  'truthout.org', 'commondreams.org', 'mondoweiss.net',

  // Science & Health
  'nature.com', 'sciencemag.org', 'newscientist.com', 'nationalgeographic.com',
  'scientificamerican.com', 'statnews.com', 'healthline.com',
  'medicalnewstoday.com', 'webmd.com', 'mayoclinic.org', 'nih.gov',
  'cdc.gov', 'who.int', 'thelancet.com', 'nejm.org', 'bmj.com',
  'pnas.org', 'cell.com', 'space.com', 'phys.org', 'sciencedaily.com',

  // Climate & Environment
  'insideclimatenews.org', 'climatecentral.org', 'carbonbrief.org',
  'yaleclimateconnections.org', 'grist.org', 'earther.com',
  'eenews.net', 'e360.yale.edu', 'desmog.com',

  // Regional/Local News
  'seattletimes.com', 'oregonlive.com', 'denverpost.com', 'dallasnews.com',
  'houstonchronicle.com', 'chron.com', 'ajc.com', 'miamiherald.com',
  'tampabay.com', 'orlandosentinel.com', 'baltimoresun.com',
  'philly.com', 'inquirer.com', 'detroitnews.com', 'cleveland.com',
  'stltoday.com', 'startribune.com', 'azcentral.com', 'reviewjournal.com',

  // Substack Publications (Major Individual Newsletters)
  'substack.com', 'newsletter.substack.com', 'beehiiv.com',
  'ghost.org', 'buttondown.email', 'revue.co',

  // Popular Substack Authors/Publications (examples)
  'mattyglez.substack.com', 'thedispatch.com', 'bariweiss.substack.com',
  'glenngreenwaldsubstack.com', 'matttaibbi.substack.com',
  'astralcodexten.substack.com', 'slowboring.com', 'noahpinion.substack.com',
  'popularinfo.substack.com', 'heathercoxrichardson.substack.com',

  // Investigative & Longform
  'revealnews.org', 'publicintegrity.org', 'opensecrets.org',
  'followthemoney.org', 'icij.org', 'marshallproject.org',
  'thebureauinvestigates.com', 'newamerica.org', 'brookings.edu',

  // Think Tanks & Policy
  'rand.org', 'cfr.org', 'csis.org', 'heritage.org', 'aei.org',
  'urban.org', 'pewresearch.org', 'brennancenter.org', 'aclu.org',

  // Legal & Courts
  'scotusblog.com', 'lawfaremedia.org', 'justia.com', 'law.com',
  'abajournal.com', 'courthousenews.com', 'supremecourt.gov',

  // Energy & Resources
  'oilprice.com', 'energycentral.com', 'renewableenergyworld.com',
  'greentechmedia.com', 'utilitydive.com', 'powermag.com',

  // Transportation & Aerospace
  'flightglobal.com', 'aviationweek.com', 'aopa.org', 'nasa.gov',
  'spacenews.com', 'spaceflightnow.com', 'nasaspaceflight.com',

  // Media Industry
  'niemanlab.org', 'cjr.org', 'poynter.org', 'mediapost.com',
  'adweek.com', 'adage.com', 'variety.com', 'hollywoodreporter.com',
  'deadline.com', 'tvline.com', 'ew.com', 'avclub.com',

  // Sports News
  'espn.com', 'si.com', 'bleacherreport.com', 'deadspin.com',
  'theringer.com', 'athleticmedia.com', 'cbssports.com', 'foxsports.com',
  'sportingnews.com', 'nfl.com', 'nba.com', 'mlb.com', 'nhl.com',

  // Crypto & Blockchain
  'coindesk.com', 'cointelegraph.com', 'decrypt.co', 'theblock.co',
  'coinbase.com/blog', 'bitcoin.com', 'cryptoslate.com',

  // General Blogging/Newsletter Platforms
  'medium.com', 'wordpress.com', 'blogger.com', 'tumblr.com',
  'linkedin.com/pulse', 'quora.com/q'
];

/**
 * Check if a URL matches any domain in a list
 */
function matchesDomainList(url: string, domainList: string[]): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

    return domainList.some(domain => {
      // Exact match
      if (hostname === domain) return true;
      // Subdomain match (e.g., blog.example.com matches example.com)
      if (hostname.endsWith('.' + domain)) return true;
      return false;
    });
  } catch {
    return false;
  }
}

/**
 * Check if a URL is from a community domain (skip processing)
 */
export function isCommunityDomain(url: string): boolean {
  return matchesDomainList(url, COMMUNITY_DOMAINS);
}

/**
 * Check if a URL is from a social media domain
 */
export function isSocialMediaDomain(url: string): boolean {
  return matchesDomainList(url, SOCIAL_MEDIA_DOMAINS);
}

/**
 * Check if a URL is from a file hosting/CDN domain
 */
export function isFileHostingDomain(url: string): boolean {
  return matchesDomainList(url, FILE_HOSTING_DOMAINS);
}

/**
 * Check if a URL should be processed for archiving/posting
 * Returns true for any URL that is NOT:
 * - Community domain (our own sites)
 * - Social media (handled separately)
 * - File hosting/CDN
 */
export function shouldProcessUrl(url: string): boolean {
  // Skip community domains
  if (isCommunityDomain(url)) {
    console.log(`⏭️  Skipping community domain: ${url}`);
    return false;
  }

  // Skip social media (handled by social media detector)
  if (isSocialMediaDomain(url)) {
    return false;
  }

  // Skip file hosting
  if (isFileHostingDomain(url)) {
    return false;
  }

  // Process everything else
  return true;
}

/**
 * Check if a URL is from a known news domain (legacy whitelist - kept for backwards compatibility)
 * @deprecated Use shouldProcessUrl() instead for exclusion-based approach
 */
export function isNewsDomain(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Remove www. prefix if present
    const domain = hostname.replace(/^www\./, '');

    // Check if domain matches any news domain
    return NEWS_DOMAINS.some(newsDomain => {
      // Exact match
      if (domain === newsDomain) return true;

      // Subdomain match (e.g., blog.cnn.com matches cnn.com)
      if (domain.endsWith('.' + newsDomain)) return true;

      return false;
    });
  } catch (error) {
    console.error('Error parsing URL:', error);
    return false;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase().replace(/^www\./, '');
  } catch (error) {
    return null;
  }
}

/**
 * Detect all news URLs in a message (legacy - whitelist based)
 * @deprecated Use detectProcessableUrls() instead
 */
export function detectNewsUrls(text: string, urlList: string[]): string[] {
  return urlList.filter(url => isNewsDomain(url));
}

/**
 * Detect all URLs that should be processed (exclusion-based)
 * Returns URLs that are NOT community, social media, or file hosting
 */
export function detectProcessableUrls(text: string, urlList: string[]): string[] {
  return urlList.filter(url => shouldProcessUrl(url));
}
