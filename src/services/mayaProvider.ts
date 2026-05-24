import { NewsItem } from '../app/api/news/route';

export interface MayaRequest {
  mode: 'chronist' | 'optimist' | 'analyst' | 'uebersetzer';
  newsItem: NewsItem;
  geoRadius: 'local' | 'regional' | 'national' | 'global';
  history?: Array<{ role: 'user' | 'model'; text: string }>;
  userMessage?: string; // Für den interaktiven Chat über den Artikel
}

export interface MayaResponse {
  factsSummary: string; // Neutrale Zusammenfassung
  commentary: string;   // Mayas markierter Kommentar mit Audio-Tags
  dialogueReply?: string; // Antwort im Chat-Dialog (falls userMessage vorhanden)
}

/**
 * Der mayaProvider kapselt alle Interaktionen mit Maya.
 * Dies erleichtert eine spätere Migration zu einer zentralen maya-core-Struktur,
 * ohne dass die UI-Komponenten geändert werden müssen.
 */
export async function askMaya(params: MayaRequest): Promise<MayaResponse> {
  try {
    const response = await fetch('/api/maya/comment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Fehler bei der Kommunikation mit Maya');
    }

    return await response.json();
  } catch (error: any) {
    console.error('Fehler in askMaya:', error);
    throw error;
  }
}
