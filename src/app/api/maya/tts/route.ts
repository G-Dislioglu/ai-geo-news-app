import { NextResponse } from 'next/server';

// Hilfsfunktion zur Erstellung eines standardmäßigen 44-Byte WAV-Headers.
// Da gemini-3.1-flash-tts-preview Roh-PCM mit 24kHz, 16-Bit Mono ausgibt,
// müssen wir diese Daten mit einem RIFF/WAVE-Header versehen, damit der
// HTML5 Audio-Player im Browser sie nativ decodieren und abspielen kann.
function addWavHeader(pcmBuffer: Buffer, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcmBuffer.length;
  const fileSize = 36 + dataSize;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  // RIFF-Kennung
  header.write('RIFF', 0);
  // Dateigröße minus 8 Byte
  header.writeUInt32LE(fileSize, 4);
  // WAVE-Format
  header.write('WAVE', 8);
  // fmt-Chunk Kennung
  header.write('fmt ', 12);
  // fmt-Chunk Größe (16 Byte)
  header.writeUInt32LE(16, 16);
  // Audio-Format: Linear PCM (1)
  header.writeUInt16LE(1, 20);
  // Kanäle: Mono (1)
  header.writeUInt16LE(numChannels, 22);
  // Sample-Rate (24000 Hz)
  header.writeUInt32LE(sampleRate, 24);
  // Byte-Rate
  header.writeUInt32LE(byteRate, 28);
  // Block-Align (2 Byte)
  header.writeUInt16LE(blockAlign, 32);
  // Bits per Sample (16 Bit)
  header.writeUInt16LE(bitsPerSample, 34);
  // data-Chunk Kennung
  header.write('data', 36);
  // Daten-Größe (PCM Byte-Länge)
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export async function POST(request: Request) {
  try {
    const { text } = await request.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      return NextResponse.json({ error: 'API-Schlüssel nicht konfiguriert' }, { status: 400 });
    }

    if (!text) {
      return NextResponse.json({ error: 'Kein Text übermittelt' }, { status: 400 });
    }

    const cleanText = text.replace(/\[.*?\]/g, '').trim();

    // Aufruf des dedizierten Modells gemini-3.1-flash-tts-preview
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`;
    
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Lies folgenden Text in deutscher Sprache mit deiner wachen, klaren Stimme Autonoe in natürlichem, normalem Sprechtempo vor. Beachte die eingebetteten Modulationsanweisungen:\n\n${text}`
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ['audio'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Aoede' // Aoede ist die perfekte Stimme für Maya
            }
          }
        }
      }
    };

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('Gemini Audio Generation fehlgeschlagen, weiche auf Client-seitige Synthese aus:', errText);
      return NextResponse.json({ fallback: true, cleanText });
    }

    const data = await response.json();
    
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.find((p: any) => p.inlineData && p.inlineData.mimeType.startsWith('audio/'));
    
    if (part && part.inlineData) {
      // Rohe PCM-Audiodaten in Node-Buffer umwandeln
      const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
      
      // WAV-Header hinzufügen (24kHz, Mono, 16-Bit)
      const wavBuffer = addWavHeader(pcmBuffer, 24000, 1, 16);
      
      // Zurück in Base64 umwandeln und als voll-kompatibles audio/wav zurücksenden
      const wavBase64 = wavBuffer.toString('base64');

      return NextResponse.json({
        success: true,
        audioContent: wavBase64,
        mimeType: 'audio/wav'
      });
    }

    return NextResponse.json({ fallback: true, cleanText });
  } catch (error: any) {
    console.error('Fehler in POST /api/maya/tts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
