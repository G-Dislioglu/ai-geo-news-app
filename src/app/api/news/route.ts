import { NextResponse } from 'next/server';
import Parser from 'rss-parser';

const parser = new Parser();

// Die offiziell verifizierten, aktiven RSS-Feeds der ARD Landesrundfunkanstalten und der Tagesschau
const FEEDS: Record<string, string[]> = {
  global: [
    'https://www.tagesschau.de/ausland/~rss2.xml'
  ],
  national: [
    'https://www.tagesschau.de/inland/~rss2.xml'
  ],
  regional: [
    'https://www.ndr.de/nachrichten/index-rss.xml',
    'https://www.br.de/nachrichten/meldungen-100~rss.xml',
    'https://www.rbb24.de/aktuell/index.xml/feed=rss.xml'
  ],
  local: [
    'https://www.ndr.de/nachrichten/index-rss.xml',
    'https://www.br.de/nachrichten/meldungen-100~rss.xml',
    'https://www.rbb24.de/aktuell/index.xml/feed=rss.xml'
  ]
};

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  contentSnippet: string;
  pubDate: string;
  source: string;
  sourceUrl: string;
  level: 'local' | 'regional' | 'national' | 'global';
  status: 'belegt' | 'vorlaeufig';
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level') || 'national';
    
    if (!['local', 'regional', 'national', 'global'].includes(level)) {
      return NextResponse.json({ error: 'Ungültige geografische Ebene' }, { status: 400 });
    }

    const feedUrls = FEEDS[level] || FEEDS.national;
    const allItems: NewsItem[] = [];

    for (const url of feedUrls) {
      try {
        const feed = await parser.parseURL(url);
        const sourceName = feed.title || new URL(url).hostname;
        
        if (feed.items) {
          for (const item of feed.items) {
            const title = item.title || '';
            const content = item.contentSnippet || item.content || '';
            const link = item.link || '';
            
            // Da alle Feeds aus verifizierten, redaktionell geprüften Quellen (ARD / Tagesschau) stammen,
            // sind alle geladenen Nachrichten als "belegt" einzustufen.
            const status = 'belegt';

            allItems.push({
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
      } catch (feedError) {
        console.warn(`Fehler beim Laden von Feed ${url} (wird übersprungen):`, feedError);
      }
    }

    // Sortierung nach Datum und Begrenzung
    const sortedItems = allItems
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
      .slice(0, 15);

    return NextResponse.json({ news: sortedItems });
  } catch (error: any) {
    console.error('Fehler in GET /api/news:', error);
    return NextResponse.json({ error: 'Serverfehler beim Laden der Nachrichten' }, { status: 500 });
  }
}
