/**
 * News Domain Detection Utility
 * Salvaged from /modern-stack/archive/experimental/remote-scraper-plugin.js
 */

// Comprehensive news domains for auto-detection
export const NEWS_DOMAINS = [
  // Major News Networks
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com', 'economist.com',
  'reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'foxnews.com',
  'npr.org', 'guardian.com', 'independent.co.uk', 'telegraph.co.uk',
  'usatoday.com', 'abcnews.go.com', 'cbsnews.com', 'nbcnews.com',
  'pbs.org', 'axios.com', 'politico.com', 'thehill.com', 'vox.com',
  'msnbc.com', 'newsweek.com', 'time.com', 'latimes.com', 'nypost.com',
  'chicagotribune.com', 'bostonglobe.com', 'sfchronicle.com', 'mercurynews.com',

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

  // Military & Defense
  'military.com', 'militarytimes.com', 'defense.gov', 'defenseone.com',
  'breakingdefense.com', 'c4isrnet.com', 'defensenews.com', 'armytimes.com',
  'navytimes.com', 'airforcetimes.com', 'marinecorpstimes.com',
  'stripes.com', 'nationaldefensemagazine.org', 'janes.com',
  'thedrive.com/the-war-zone', 'sofrep.com', 'taskandpurpose.com',
  'wearethemighty.com', 'sandboxx.us', 'coffeeordie.com',

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
 * Check if a URL is from a known news domain
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
 * Detect all news URLs in a message
 */
export function detectNewsUrls(text: string, urlList: string[]): string[] {
  return urlList.filter(url => isNewsDomain(url));
}
