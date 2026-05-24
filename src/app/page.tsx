'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, Globe, Compass, Shield, Volume2, Mic, MicOff, 
  Send, RefreshCw, BookOpen, Layers, MessageSquare, Sparkles, AlertCircle 
} from 'lucide-react';
import { NewsItem } from './api/news/route';

export interface MayaResponse {
  factsSummary: string; // Neutrale Zusammenfassung (Schicht 1)
  commentary: string;   // Mayas Kommentar (Schicht 2)
  dialogueReply?: string; // Optionale Antwort
}

export default function Home() {
  // App-Zustände
  const [geoRadius, setGeoRadius] = useState<'regional' | 'national' | 'global'>('national');
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState<boolean>(false);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  
  // Maya-Zustände
  const [lensMode, setLensMode] = useState<'chronist' | 'optimist' | 'analyst' | 'uebersetzer'>('chronist');
  const [mayaData, setMayaData] = useState<MayaResponse | null>(null);
  const [loadingMaya, setLoadingMaya] = useState<boolean>(false);
  const [mayaError, setMayaError] = useState<string | null>(null);
  
  // Chat-Dialog Zustände
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [loadingChat, setLoadingChat] = useState<boolean>(false);
  
  // Audio & Spracherkennung Zustände
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(false);
  
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<{
    sentences: string[];
    currentIndex: number;
    audioObjects: (HTMLAudioElement | null)[];
    fetchPromises: (Promise<HTMLAudioElement | null>)[];
    isPlaying: boolean;
    abortController: AbortController | null;
  }>({
    sentences: [],
    currentIndex: 0,
    audioObjects: [],
    fetchPromises: [],
    isPlaying: false,
    abortController: null,
  });
  const recognitionRef = useRef<any>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Map slider value (0-2) to string levels
  const sliderValues: Array<'regional' | 'national' | 'global'> = ['regional', 'national', 'global'];
  const getSliderIndex = (val: 'regional' | 'national' | 'global') => sliderValues.indexOf(val);

  // 1. Auslesen der gespeicherten Region aus localStorage beim Mounten
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('geoSphere_region');
      if (saved) {
        setSelectedRegion(saved);
      }
    }
  }, []);

  // 2. Nachrichten laden bei Änderung des Geo-Radius oder der Region
  useEffect(() => {
    fetchNews(geoRadius, selectedRegion);
  }, [geoRadius, selectedRegion]);

  const handleRegionChange = (regionVal: string) => {
    setSelectedRegion(regionVal);
    if (typeof window !== 'undefined') {
      localStorage.setItem('geoSphere_region', regionVal);
    }
  };

  // 2. Mayas Kommentar neu generieren bei Wechsel des Artikels oder der Linse
  useEffect(() => {
    if (selectedNews) {
      generateMayaCommentary();
    }
  }, [selectedNews, lensMode]);

  // Scroll zum Ende des Chats bei neuen Nachrichten
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const fetchNews = async (level: string, regionVal = selectedRegion) => {
    setLoadingNews(true);
    try {
      const res = await fetch(`/api/news?level=${level}&region=${regionVal}`);
      if (!res.ok) throw new Error('Fehler beim Laden');
      const data = await res.json();
      setNews(data.news || []);
      // Resette Selektion bei Ebenenwechsel
      setSelectedNews(null);
      setMayaData(null);
      setChatHistory([]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingNews(false);
    }
  };

  const stopAudio = () => {
    // Abbrechen aller aktiven Chunks und Ladevorgänge der Satz-Queue
    if (audioQueueRef.current) {
      audioQueueRef.current.isPlaying = false;
      if (audioQueueRef.current.abortController) {
        audioQueueRef.current.abortController.abort();
      }
      audioQueueRef.current.audioObjects.forEach(audio => {
        if (audio) {
          audio.pause();
          if (audio.src && audio.src.startsWith('blob:')) {
            URL.revokeObjectURL(audio.src);
          }
        }
      });
      audioQueueRef.current.audioObjects = [];
      audioQueueRef.current.fetchPromises = [];
    }

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      if (currentAudioRef.current.src && currentAudioRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(currentAudioRef.current.src);
      }
      currentAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPlayingAudio(false);
  };

  const speakBrowserFallback = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setIsPlayingAudio(false);
      alert('Sprachwiedergabe in diesem Browser nicht unterstützt.');
      return;
    }

    const cleanText = text.replace(/\[.*?\]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'de-DE';
    
    const voices = window.speechSynthesis.getVoices();
    const germanVoice = voices.find(v => v.lang.startsWith('de') && v.name.includes('Google')) || 
                        voices.find(v => v.lang.startsWith('de')) || 
                        voices[0];
    
    if (germanVoice) {
      utterance.voice = germanVoice;
    }

    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);
    
    window.speechSynthesis.speak(utterance);
  };

  // Asynchroner Queue-Player. Unterstützt sowohl statische Texte als auch Echtzeit-Streaming (isDynamic=true)
  const speakText = async (text: string, isDynamic = false) => {
    stopAudio();
    setIsPlayingAudio(true);

    const abortController = new AbortController();
    
    // Splitte an Satzgrenzen (. ! ?), Audio-Tags wie [thoughtfully] bleiben bei ihren Sätzen
    const sentences = isDynamic ? [] : text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    
    const queue = {
      sentences,
      currentIndex: 0,
      audioObjects: new Array(sentences.length).fill(null),
      fetchPromises: new Array(sentences.length).fill(null),
      isPlaying: true,
      abortController,
    };
    audioQueueRef.current = queue;

    // Einzelnen Satz vertonen und Audio-Objekt erstellen
    const fetchChunk = async (index: number): Promise<HTMLAudioElement | null> => {
      if (!queue.isPlaying || queue.abortController?.signal.aborted) return null;
      if (index >= queue.sentences.length) return null;
      if (queue.audioObjects[index]) return queue.audioObjects[index];

      try {
        const res = await fetch('/api/maya/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: queue.sentences[index] }),
          signal: queue.abortController?.signal,
        });

        if (!res.ok) throw new Error();
        const data = await res.json();

        if (data.success && data.audioContent) {
          const binaryString = window.atob(data.audioContent);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: data.mimeType || 'audio/wav' });
          const audioSrc = URL.createObjectURL(blob);
          const audio = new Audio(audioSrc);
          
          audio.onerror = () => URL.revokeObjectURL(audioSrc);
          queue.audioObjects[index] = audio;
          return audio;
        }
        return null;
      } catch (err) {
        console.warn(`Fehler beim Laden von Satz-Chunk ${index}:`, err);
        return null;
      }
    };

    // Helfer für asynchrones Vorladen
    const prefetchNext = (index: number) => {
      if (index < queue.sentences.length && !queue.fetchPromises[index]) {
        queue.fetchPromises[index] = fetchChunk(index);
      }
    };

    // Für statischen Text direkt die ersten beiden Sätze parallel vorladen
    if (!isDynamic) {
      prefetchNext(0);
      prefetchNext(1);
    }

    // Wiedergabe-Schleife
    const playNext = async () => {
      if (!queue.isPlaying || queue.abortController?.signal.aborted) {
        setIsPlayingAudio(false);
        return;
      }

      const index = queue.currentIndex;
      
      // Falls der nächste Satz im Dynamic-Stream noch nicht geladen wurde, warten wir auf den Push
      if (index >= queue.sentences.length) {
        if (isDynamic) {
          return; // Schleife pausiert, bis pushSentence den Wiedergabe-Loop erneut aufruft
        } else {
          setIsPlayingAudio(false);
          queue.isPlaying = false;
          return;
        }
      }

      // Den übernächsten Satz bereits im Hintergrund vorladen
      prefetchNext(index + 2);

      let audio: HTMLAudioElement | null = null;
      try {
        audio = await queue.fetchPromises[index];
      } catch (err) {
        console.warn(`Fehler beim Warten auf Satz-Fetch ${index}:`, err);
      }

      if (audio) {
        currentAudioRef.current = audio;
        audio.play().then(() => {
          audio!.onended = () => {
            queue.currentIndex++;
            playNext();
          };
        }).catch(err => {
          console.warn(`Wiedergabe-Promise fehlgeschlagen für Satz ${index}, weiche auf Web Speech aus:`, err);
          playFallbackSentence(queue.sentences[index], () => {
            queue.currentIndex++;
            playNext();
          });
        });
      } else {
        playFallbackSentence(queue.sentences[index], () => {
          queue.currentIndex++;
          playNext();
        });
      }
    };

    // Externe Hooks für die Streaming-Wiedergabe
    (queue as any).pushSentence = (sentence: string) => {
      queue.sentences.push(sentence);
      queue.audioObjects.push(null);
      queue.fetchPromises.push(null as any);
      
      const newIndex = queue.sentences.length - 1;
      prefetchNext(newIndex);
      
      // Falls der Player am Ende gewartet hat, starten wir die Wiedergabe neu
      if (queue.currentIndex === newIndex) {
        playNext();
      }
    };

    (queue as any).finalizeDynamic = () => {
      if (queue.currentIndex >= queue.sentences.length) {
        setIsPlayingAudio(false);
        queue.isPlaying = false;
      }
    };

    // Für statischen Text die Schleife direkt anwerfen
    if (!isDynamic) {
      playNext();
    }
  };

  // Web Speech API Fallback für einen Satz
  const playFallbackSentence = (sentenceText: string, onDone: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      onDone();
      return;
    }
    const cleanText = sentenceText.replace(/\[.*?\]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'de-DE';
    
    const voices = window.speechSynthesis.getVoices();
    const germanVoice = voices.find(v => v.lang.startsWith('de') && v.name.includes('Google')) || 
                        voices.find(v => v.lang.startsWith('de')) || 
                        voices[0];
    if (germanVoice) {
      utterance.voice = germanVoice;
    }

    utterance.onend = () => onDone();
    utterance.onerror = () => onDone();
    window.speechSynthesis.speak(utterance);
  };

  // Hebel A: Paralleles Laden von Fakten und gestreamtem Kommentar
  const generateMayaCommentary = async () => {
    if (!selectedNews) return;
    setLoadingMaya(true);
    setMayaError(null);
    setMayaData({ factsSummary: '', commentary: '' });
    setChatHistory([]); 
    stopAudio();

    // 1. Fakten-Laden (Aktion 'facts' - extrem schneller JSON Call für Schicht 1)
    const fetchFactsPromise = fetch('/api/maya/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'facts',
        mode: lensMode,
        newsItem: selectedNews,
        geoRadius
      })
    }).then(async res => {
      if (!res.ok) throw new Error('Fakten-Laden fehlgeschlagen');
      const data = await res.json();
      setMayaData(prev => ({
        factsSummary: data.factsSummary,
        commentary: prev?.commentary || ''
      }));
    }).catch(err => {
      console.warn('Fakten konnten nicht geladen werden:', err);
    });

    // 2. Kommentar-Streaming (Aktion 'commentary_stream' - Live text streaming für Schicht 2)
    try {
      if (autoSpeak) {
        speakText('', true); // Initialisiere die dynamische Audio-Queue
      }

      const res = await fetch('/api/maya/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'commentary_stream',
          mode: lensMode,
          newsItem: selectedNews,
          geoRadius
        })
      });

      if (!res.ok) throw new Error('Kommentar-Streaming fehlgeschlagen');
      
      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let fullCommentary = '';
      let lastPlayedIndex = 0;

      if (reader) {
        // Lade-Indikator ausblenden, sobald die ersten Chunks strömen
        setLoadingMaya(false);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          fullCommentary += chunk;

          // Text live im UI updaten
          setMayaData(prev => ({
            factsSummary: prev?.factsSummary || '',
            commentary: fullCommentary
          }));

          // Extrahiere fertig gestreamte Sätze für direkte Audiowiedergabe
          const sentences = fullCommentary.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
          
          if (sentences.length > lastPlayedIndex) {
            // Ist der letzte Satz bereits vollendet (endet mit Satzzeichen)?
            const isCompleted = /[.!?]$/.test(sentences[sentences.length - 1].trim());
            const playLimit = isCompleted ? sentences.length : sentences.length - 1;

            for (let i = lastPlayedIndex; i < playLimit; i++) {
              if (autoSpeak && audioQueueRef.current && (audioQueueRef.current as any).pushSentence) {
                (audioQueueRef.current as any).pushSentence(sentences[i]);
              }
            }
            lastPlayedIndex = playLimit;
          }
        }

        // --- Stream-Abschluss für verbleibende Sätze ---
        const finalSentences = fullCommentary.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        if (finalSentences.length > lastPlayedIndex) {
          for (let i = lastPlayedIndex; i < finalSentences.length; i++) {
            if (autoSpeak && audioQueueRef.current && (audioQueueRef.current as any).pushSentence) {
              (audioQueueRef.current as any).pushSentence(finalSentences[i]);
            }
          }
        }

        // Finalisiere dynamic queue
        if (autoSpeak && audioQueueRef.current && (audioQueueRef.current as any).finalizeDynamic) {
          (audioQueueRef.current as any).finalizeDynamic();
        }
      }
    } catch (err: any) {
      console.error(err);
      setMayaError(err.message || 'Kommentar-Streaming fehlgeschlagen');
      setLoadingMaya(false);
    }
  };

  // Audio-Wiedergabe manuell auslösen (TTS)
  const handlePlayAudio = () => {
    if (!mayaData) return;
    if (isPlayingAudio) {
      stopAudio();
    } else {
      speakText(mayaData.commentary);
    }
  };

  // Chat-Nachricht senden (Aktion 'dialogue_stream' - Live Streaming im Chat für Schicht 3)
  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !selectedNews || !mayaData || loadingChat) return;

    const userMsg = chatInput.trim();
    setChatInput('');
    stopAudio();
    
    const updatedHistory = [...chatHistory, { role: 'user' as const, text: userMsg }];
    setChatHistory(updatedHistory);
    setLoadingChat(true);

    // Füge einen leeren Slot für Mayas gestreamte Antwort hinzu
    setChatHistory(prev => [...prev, { role: 'model' as const, text: '' }]);

    try {
      if (autoSpeak) {
        speakText('', true); // Dynamische Queue initialisieren
      }

      const res = await fetch('/api/maya/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dialogue_stream',
          mode: lensMode,
          newsItem: selectedNews,
          geoRadius,
          history: updatedHistory.slice(0, -1), // Bisheriger Verlauf (ohne aktuelle userMsg)
          userMessage: userMsg
        })
      });

      if (!res.ok) throw new Error('Chat-Streaming fehlgeschlagen');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let fullReply = '';
      let lastPlayedIndex = 0;

      if (reader) {
        setLoadingChat(false);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          fullReply += chunk;

          // Chatverlauf mit einströmendem Text live updaten
          setChatHistory(prev => {
            const nextHistory = [...prev];
            if (nextHistory.length > 0) {
              nextHistory[nextHistory.length - 1] = {
                role: 'model' as const,
                text: fullReply
              };
            }
            return nextHistory;
          });

          // Sätze extrahieren und dynamic audio queue füttern
          const sentences = fullReply.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
          
          if (sentences.length > lastPlayedIndex) {
            const isCompleted = /[.!?]$/.test(sentences[sentences.length - 1].trim());
            const playLimit = isCompleted ? sentences.length : sentences.length - 1;

            for (let i = lastPlayedIndex; i < playLimit; i++) {
              if (autoSpeak && audioQueueRef.current && (audioQueueRef.current as any).pushSentence) {
                (audioQueueRef.current as any).pushSentence(sentences[i]);
              }
            }
            lastPlayedIndex = playLimit;
          }
        }

        // --- Stream-Abschluss für verbleibende Sätze im Dialog ---
        const finalSentences = fullReply.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        if (finalSentences.length > lastPlayedIndex) {
          for (let i = lastPlayedIndex; i < finalSentences.length; i++) {
            if (autoSpeak && audioQueueRef.current && (audioQueueRef.current as any).pushSentence) {
              (audioQueueRef.current as any).pushSentence(finalSentences[i]);
            }
          }
        }

        if (autoSpeak && audioQueueRef.current && (audioQueueRef.current as any).finalizeDynamic) {
          (audioQueueRef.current as any).finalizeDynamic();
        }
      }
    } catch (err) {
      console.error(err);
      setChatHistory(prev => {
        const nextHistory = [...prev];
        if (nextHistory.length > 0) {
          nextHistory[nextHistory.length - 1] = {
            role: 'model' as const,
            text: '[Fehler] Entschuldige, ich konnte deine Nachricht gerade nicht verarbeiten.'
          };
        }
        return nextHistory;
      });
      setLoadingChat(false);
    }
  };

  // "Diktieren und Zuhören" - Browser Spracherkennung
  const handleToggleListening = () => {
    if (typeof window === 'undefined') return;
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Spracherkennung wird von deinem Browser nicht unterstützt. Bitte nutze Google Chrome.');
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    setIsListening(true);
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    
    recognition.lang = 'de-DE';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const resultText = event.results[0][0].transcript;
      setChatInput(prev => (prev ? prev + ' ' + resultText : resultText));
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Spracherkennungsfehler:', event.error);
      setIsListening(false);
    };

    recognition.start();
  };

  return (
    <main className="relative min-h-screen px-4 py-8 md:px-8 max-w-7xl mx-auto flex flex-col gap-6">
      {/* Ambient background decoration */}
      <div className="ambient-container">
        <div className="ambient-blob blob-1"></div>
        <div className="ambient-blob blob-2"></div>
        <div className="ambient-blob blob-3"></div>
      </div>

      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Powered by Maya</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400">
            GeoSphere News
          </h1>
        </div>
      </header>

      {/* Haupt-Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LINKE SPALTE: News Feed & Slider (5 Spalten) */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Geo-Slider Panel */}
          <div className="glass-panel p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold tracking-wider text-slate-300 uppercase flex items-center gap-2">
                <Compass className="w-4 h-4 text-cyan-400" /> Geografischer Fokus
              </h2>
              <span className={`geo-badge ${geoRadius}`}>
                {geoRadius === 'regional' && (selectedRegion ? 'Regional' : 'Region wählen')}
                {geoRadius === 'national' && 'Landesweit'}
                {geoRadius === 'global' && 'Weltweit'}
              </span>
            </div>
            
            <input 
              type="range" 
              min="0" 
              max="2" 
              value={getSliderIndex(geoRadius)}
              onChange={(e) => setGeoRadius(sliderValues[parseInt(e.target.value)])}
              className="geo-slider my-2"
            />
            
            <div className="flex justify-between text-[11px] font-semibold text-slate-400 uppercase px-1">
              <span className={geoRadius === 'regional' ? 'text-purple-400' : ''}>Region</span>
              <span className={geoRadius === 'national' ? 'text-blue-400' : ''}>Bund</span>
              <span className={geoRadius === 'global' ? 'text-cyan-400' : ''}>Welt</span>
            </div>

            {/* Region Dropdown Selector */}
            {geoRadius === 'regional' && (
              <div className="flex flex-col gap-2 mt-3 border-t border-white/5 pt-3">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Wähle deine Region:</label>
                <select
                  value={selectedRegion}
                  onChange={(e) => handleRegionChange(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400/40"
                >
                  <option value="" className="bg-slate-950 text-slate-400">-- Bitte Region wählen... --</option>
                  <option value="nord" className="bg-slate-950 text-white">Norddeutschland (NDR)</option>
                  <option value="nrw" className="bg-slate-950 text-white">Nordrhein-Westfalen (WDR)</option>
                  <option value="bayern" className="bg-slate-950 text-white">Bayern (BR)</option>
                  <option value="bw" className="bg-slate-950 text-white">Baden-Württemberg (SWR)</option>
                  <option value="rp" className="bg-slate-950 text-white">Rheinland-Pfalz (SWR)</option>
                  <option value="berlin_brandenburg" className="bg-slate-950 text-white">Berlin & Brandenburg (rbb)</option>
                  <option value="hessen" className="bg-slate-950 text-white">Hessen (hr - Kein Feed verfügbar)</option>
                  <option value="saarland" className="bg-slate-950 text-white">Saarland (SR - Kein Feed verfügbar)</option>
                  <option value="sachsen" className="bg-slate-950 text-white">Sachsen (MDR - Kein Feed verfügbar)</option>
                  <option value="sachsen_anhalt" className="bg-slate-950 text-white">Sachsen-Anhalt (MDR - Kein Feed verfügbar)</option>
                  <option value="thueringen" className="bg-slate-950 text-white">Thüringen (MDR - Kein Feed verfügbar)</option>
                </select>

                {/* Erstbesuchs-Hinweis */}
                {selectedRegion === '' && (
                  <div className="text-[10px] text-cyan-300 bg-cyan-950/20 border border-cyan-900/50 rounded-lg p-2.5 leading-relaxed mt-1 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <span>
                      Bitte wähle eine Region aus, um lokale Nachrichten anzuzeigen. Bis dahin zeigen wir dir Meldungen aus ganz Deutschland.
                    </span>
                  </div>
                )}

                {/* Info-Box für Lücken */}
                {['hessen', 'saarland', 'sachsen', 'sachsen_anhalt', 'thueringen'].includes(selectedRegion) && (
                  <div className="text-[10px] text-amber-300 bg-amber-950/20 border border-amber-900/50 rounded-lg p-2.5 leading-relaxed mt-1 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Transparenz-Hinweis:</strong> Für diese Region stellt der zuständige ARD-Sender aktuell keinen aktiven, standardkonformen RSS-Nachrichten-Feed zur Verfügung. Um Täuschungen zu vermeiden, zeigen wir dir stattdessen den verifizierten, bundesweiten Tagesschau-Feed an.
                    </span>
                  </div>
                )}

                {/* Deskriptiver Hinweis für aktive Feeds */}
                {['nord', 'nrw', 'bayern', 'bw', 'rp', 'berlin_brandenburg'].includes(selectedRegion) && (
                  <div className="text-[10px] text-slate-400 bg-white/2 border border-white/5 rounded-lg p-2.5 leading-relaxed mt-1">
                    <span className="font-semibold text-emerald-400">Transparenz-Hinweis:</span> Dieser Fokus nutzt die regionalen Feeds der ARD-Landesrundfunkanstalten (z. B. NDR, BR, rbb), um geprüfte Regionalmeldungen aus deiner erweiterten Umgebung anzuzeigen.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* News Feed List */}
          <div className="glass-panel p-4 flex flex-col gap-4 max-h-[650px] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/5 pb-3 px-2">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-cyan-400" /> Echte Schlagzeilen
              </h3>
              <button 
                onClick={() => fetchNews(geoRadius)}
                disabled={loadingNews}
                className="text-slate-400 hover:text-white transition p-1 hover:bg-white/5 rounded-lg disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loadingNews ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingNews ? (
              <div className="flex flex-col gap-3 py-12 items-center justify-center text-slate-400">
                <div className="w-8 h-8 rounded-full border-2 border-cyan-400/20 border-t-cyan-400 animate-spin mb-2"></div>
                <span className="text-xs">Nachrichten werden belegt...</span>
              </div>
            ) : news.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs flex flex-col items-center gap-2">
                <AlertCircle className="w-8 h-8 text-slate-500" />
                <span>Keine aktuellen Nachrichten auf dieser Ebene gefunden.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {news.map((item) => (
                  <div 
                    key={item.id}
                    onClick={() => setSelectedNews(item)}
                    className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer flex flex-col gap-2 ${
                      selectedNews?.id === item.id 
                        ? 'bg-white/10 border-cyan-400/40 shadow-lg shadow-cyan-950/20' 
                        : 'bg-white/2 border-white/5 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[10px] font-semibold text-slate-400">
                        {item.source} • {new Date(item.pubDate).toLocaleDateString('de-DE')}
                      </span>
                      <span className={`status-badge ${item.status}`}>
                        {item.status === 'belegt' ? 'Belegt' : 'Vorläufig'}
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-white leading-snug">
                      {item.title}
                    </h4>
                    <p className="text-[11px] text-slate-400 line-clamp-2">
                      {item.contentSnippet}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* RECHTE SPALTE: Mayas Workspace (7 Spalten) */}
        <section className="lg:col-span-7">
          {!selectedNews ? (
            /* Maya Intro Panel */
            <div className="glass-panel p-8 text-center flex flex-col items-center gap-6 py-20">
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-purple-500 to-cyan-500 flex items-center justify-center p-[2px] shadow-lg shadow-purple-950/50 animate-pulse">
                <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
                  <span className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-tr from-purple-400 to-cyan-400">M</span>
                </div>
              </div>
              
              <div className="max-w-md">
                <h3 className="text-xl font-bold text-white mb-2">Ich bin Maya.</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Ich begleite dich durch das Weltgeschehen. Wähle links eine Nachricht aus, und ich werde sie für dich sachlich zusammenfassen, unter deiner bevorzugten Linse einordnen und im Gespräch begleiten.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 max-w-sm w-full text-left text-xs text-slate-400 mt-4">
                <div className="bg-white/2 border border-white/5 p-3 rounded-xl flex items-start gap-2">
                  <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span><strong>Belegte Fakten:</strong> Keine erfundenen Falschmeldungen.</span>
                </div>
                <div className="bg-white/2 border border-white/5 p-3 rounded-xl flex items-start gap-2">
                  <Compass className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span><strong>Ehrlicher Fokus:</strong> Tonal an deine Radius-Ebene angepasst.</span>
                </div>
              </div>
            </div>
          ) : (
            /* Maya Analysis Workspace (Saubere Drei-Schichten-Trennung) */
            <div className="flex flex-col gap-6">
              
              {/* Linsen-Wähler (Blickwinkel) & Auto-Speak */}
              <div className="glass-panel p-4 flex flex-col md:flex-row justify-between items-center gap-3">
                <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Mayas Linse:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(['chronist', 'optimist', 'analyst', 'uebersetzer'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setLensMode(mode)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                          lensMode === mode 
                            ? 'bg-purple-500 text-white shadow-md shadow-purple-950/20' 
                            : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {mode === 'chronist' && 'Chronist'}
                        {mode === 'optimist' && 'Optimist'}
                        {mode === 'analyst' && 'Analyst'}
                        {mode === 'uebersetzer' && 'Übersetzer'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Auto-Speak Toggle */}
                <button
                  onClick={() => setAutoSpeak(!autoSpeak)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-2 w-full md:w-auto justify-center ${
                    autoSpeak 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                      : 'bg-white/2 text-slate-500 border-white/5 hover:text-slate-400'
                  }`}
                >
                  <Volume2 className={`w-3.5 h-3.5 ${autoSpeak ? 'animate-pulse' : ''}`} />
                  <span>Auto-Speak: {autoSpeak ? 'AN' : 'AUS'}</span>
                </button>
              </div>

              {/* API Error Panel */}
              {mayaError && (
                <div className="bg-amber-950/20 border border-amber-900/50 p-4 rounded-xl text-xs text-amber-300 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block mb-1">KI-Endpunkt erfordert Konfiguration:</span>
                    <span>{mayaError}</span>
                  </div>
                </div>
              )}

              {/* DREI-SCHICHTEN-PANEL */}
              <div className="glass-panel p-6 flex flex-col gap-6">
                
                {/* 1. SCHICHT: Fakten der Quelle */}
                <div className="flex flex-col gap-2 border-b border-white/5 pb-5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-blue-400" /> Schicht 1: Fakten der Quelle
                    </span>
                    <a 
                      href={selectedNews.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[11px] text-cyan-400 hover:underline"
                    >
                      Originalartikel lesen →
                    </a>
                  </div>
                  
                  {(!mayaData || !mayaData.factsSummary) ? (
                    <div className="h-12 bg-white/2 rounded-lg animate-pulse flex items-center px-3">
                      <span className="text-[10px] text-slate-500">Fakten werden aus der Quelle belegt...</span>
                    </div>
                  ) : (
                    <div className="bg-white/2 p-3 rounded-lg border border-white/5 text-xs text-slate-300 leading-relaxed">
                      {mayaData.factsSummary}
                    </div>
                  )}
                </div>

                {/* 2. SCHICHT: Mayas Einordnung (Kommentar) */}
                <div className="flex flex-col gap-3 border-b border-white/5 pb-5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-purple-400" /> Schicht 2: Mayas Einordnung
                    </span>
                    
                    {mayaData && mayaData.commentary && (
                      <button 
                        onClick={handlePlayAudio}
                        className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition ${
                          isPlayingAudio 
                            ? 'bg-purple-500 text-white border-purple-400' 
                            : 'bg-white/2 text-slate-300 border-white/5 hover:bg-white/10'
                        }`}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>{isPlayingAudio ? 'Stopp' : 'Vorlesen'}</span>
                      </button>
                    )}
                  </div>

                  {loadingMaya ? (
                    <div className="flex flex-col gap-2 py-6 items-center justify-center text-slate-400">
                      <div className="w-6 h-6 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin mb-1"></div>
                      <span className="text-[10px]">Maya formuliert Einordnung...</span>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-200 leading-relaxed italic bg-purple-950/5 p-4 rounded-xl border border-purple-900/10">
                      {mayaData && mayaData.commentary ? (
                        mayaData.commentary.replace(/\[.*?\]/g, '').trim()
                      ) : (
                        'Kommentar wird vorbereitet...'
                      )}
                    </div>
                  )}
                </div>

                {/* 3. SCHICHT: Das Gespräch (Dialog) */}
                <div className="flex flex-col gap-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-cyan-400" /> Schicht 3: Im Dialog vertiefen
                  </span>

                  {/* Chat Box */}
                  <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4 flex flex-col gap-4 h-[240px] overflow-y-auto">
                    {chatHistory.length === 0 ? (
                      <div className="text-center py-12 text-xs text-slate-500">
                        Stelle Maya eine Frage zu diesem Artikel oder diskutiere ihre Einordnung.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {chatHistory.map((chat, idx) => {
                          // Ignoriere leere Modell-Slots im Chatverlauf während des Streams
                          if (chat.role === 'model' && !chat.text && loadingChat) return null;
                          return (
                            <div 
                              key={idx}
                              className={`flex flex-col gap-1 max-w-[85%] ${
                                chat.role === 'user' ? 'self-end items-end' : 'self-start items-start'
                              }`}
                            >
                              <span className="text-[9px] font-semibold text-slate-500 uppercase px-1">
                                {chat.role === 'user' ? 'Du' : 'Maya'}
                              </span>
                              <div className={`p-3 rounded-xl text-xs leading-relaxed ${
                                chat.role === 'user' 
                                  ? 'bg-cyan-500/10 text-cyan-200 border border-cyan-500/20' 
                                  : 'bg-white/5 text-slate-200 border border-white/5'
                              }`}>
                                {chat.role === 'model' ? (
                                  chat.text.replace(/\[.*?\]/g, '').trim()
                                ) : (
                                  chat.text
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {loadingChat && (
                          <div className="self-start flex flex-col gap-1 items-start max-w-[85%]">
                            <span className="text-[9px] font-semibold text-slate-500 uppercase px-1">Maya</span>
                            <div className="p-3 rounded-xl text-xs bg-white/5 border border-white/5 text-slate-400 flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"></span>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce delay-100"></span>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce delay-200"></span>
                            </div>
                          </div>
                        )}
                        <div ref={chatBottomRef} />
                      </div>
                    )}
                  </div>

                  {/* Input Form */}
                  <form onSubmit={handleSendChatMessage} className="flex gap-2 items-center">
                    <button
                      type="button"
                      onClick={handleToggleListening}
                      className={`p-2.5 rounded-xl border transition ${
                        isListening 
                          ? 'bg-red-500/20 text-red-400 border-red-500 animate-pulse' 
                          : 'bg-white/5 text-slate-400 border-white/5 hover:text-white hover:bg-white/10'
                      }`}
                      title="Diktieren und Zuhören"
                    >
                      {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                    <input 
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={isListening ? 'Ich höre zu...' : 'Frage Maya zum Thema...'}
                      disabled={loadingChat}
                      className="bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/40 flex-1"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || loadingChat}
                      className="p-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold disabled:opacity-50 transition shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>

                </div>

              </div>

            </div>
          )}
        </section>

      </div>
    </main>
  );
}
