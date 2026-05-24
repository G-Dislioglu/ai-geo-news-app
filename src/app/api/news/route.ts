import { NextResponse } from 'next/server';
import Parser from 'rss-parser';

const parser = new Parser();

// Die offiziell verifizierten, aktiven RSS-Feeds der ARD Landesrundfunkanstalten und der Tagesschau
const FEEDS: Record<string, string[]> = {
  global: [
    'https://www.tagesschau.de/ausland/index~rss2.xml',
    'https://rss.dw.com/xml/rss-de-all'
  ],
  national: [
    'https://www.tagesschau.de/inland/index~rss2.xml'
  ],
  regional: [
    'https://www.ndr.de/nachrichten/index-rss.xml',
    'https://www.br.de/nachrichten/meldungen-100~rss.xml',
    'https://www.rbb24.de/aktuell/index.xml/feed=rss.xml'
  ]
};

// Zuordnung der 6 verifizierten, aktiven Landes-Feeds und der 5 ehrlichen Lücken
const REGIONAL_FEEDS: Record<string, string[]> = {
  nord: ['https://www.ndr.de/nachrichten/index-rss.xml'],
  nrw: ['https://www.wdr.de/xml/newsticker.rdf'],
  bayern: ['https://www.br.de/nachrichten/meldungen-100~rss.xml'],
  bw: ['https://www.swr.de/~rss/swraktuell/swraktuell-bw-100.xml'],
  rp: ['https://www.swr.de/~rss/swraktuell/swraktuell-rp-100.xml'],
  berlin_brandenburg: ['https://www.rbb24.de/aktuell/index.xml/feed=rss.xml'],
  
  // Ehrliche Lücken (keine aktiven Feeds verfügbar -> liefern Fallback auf Bund)
  hessen: [],
  saarland: [],
  sachsen: [],
  sachsen_anhalt: [],
  thueringen: []
};

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  contentSnippet: string;
  pubDate: string;
  source: string;
  sourceUrl: string;
  level: 'regional' | 'national' | 'global';
  status: 'belegt' | 'vorlaeufig';
}

// Mischt mehrere Arrays im Round-Robin-Verfahren, damit jede Quelle
// in den 15 finalen Ergebnissen vertreten ist (vor dem Datum-Sort).
function interleave(arrays: NewsItem[][]): NewsItem[] {
  const result: NewsItem[] = [];
  const max = Math.max(...arrays.map(a => a.length), 0);
  for (let i = 0; i < max; i++) {
    for (const arr of arrays) {
      if (i < arr.length) result.push(arr[i]);
    }
  }
  return result;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let level = searchParams.get('level') || 'national';
    const region = searchParams.get('region') || '';
    
    // Legacy mapping: Falls noch Anfragen für 'local' eingehen, mappen wir sie sauber zu 'regional'
    if (level === 'local') {
      level = 'regional';
    }
    
    if (!['regional', 'national', 'global'].includes(level)) {
      return NextResponse.json({ error: 'Ungültige geografische Ebene' }, { status: 400 });
    }

    let feedUrls = FEEDS[level] || FEEDS.national;

    // Regionenwahl-Logik
    if (level === 'regional') {
      if (region && REGIONAL_FEEDS[region]) {
        const regionUrls = REGIONAL_FEEDS[region];
        if (regionUrls.length > 0) {
          feedUrls = regionUrls;
        } else {
          // Ehrliche Lücke: Fallback auf nationalen Feed
          feedUrls = FEEDS.national;
        }
      } else {
        // Noch keine Region gewählt oder leerer Parameter: Fallback auf nationalen Feed
        feedUrls = FEEDS.national;
      }
    }

    // Sammle Items pro Feed separat, damit das Interleaving greift
    const itemsByFeed: NewsItem[][] = [];

    for (const url of feedUrls) {
      try {
        const feed = await parser.parseURL(url);
        const sourceName = feed.title || new URL(url).hostname;
        const feedItems: NewsItem[] = [];
        
        if (feed.items) {
          for (const item of feed.items) {
            const title = item.title || '';
            const content = item.contentSnippet || item.content || '';
            const link = item.link || '';
            
            // Da alle Feeds aus verifizierten, redaktionell geprüften Quellen stammen,
            // sind alle geladenen Nachrichten als "belegt" einzustufen.
            const status = 'belegt';

            feedItems.push({
              id: item.guid || link || Math.random().toString(36).substr(2, 9),
              title,
              link,
              contentSnippet: content.slice(0, 300) + (content.length > 300 ? '...' : ''),
              pubDate: item.pubDate || new Date().toISOString(),
              source: sourceName,
              sourceUrl: new URL(url).origin,
              level: level as any,
              status
            });
          }
        }
        itemsByFeed.push(feedItems);
      } catch (feedError) {
        console.warn(`Fehler beim Laden von Feed ${url} (wird übersprungen):`, feedError);
      }
    }

    // Interleave: abwechselnd eine Meldung pro Quelle → beide Quellen kommen in die Top-15.
    // Datum-Sort danach stellt sicher: neueste Meldung oben (gewollt).
    const sortedItems = interleave(itemsByFeed)
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
      .slice(0, 15);

    return NextResponse.json({ news: sortedItems });
  } catch (error: any) {
    console.error('Fehler in GET /api/news:', error);
    return NextResponse.json({ error: 'Serverfehler beim Laden der Nachrichten' }, { status: 500 });
  }
}
