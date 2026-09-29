import React, { useState, useRef, useEffect } from 'react';
import { Send, PenTool, AlertCircle, Loader2 } from 'lucide-react';
import { editDocumentTextStream } from '../services/aiService';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  isLoading?: boolean;
}

export default function TaskPane() {
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: 'welcome', 
      role: 'assistant', 
      content: 'Szia! Jelölj ki egy szöveget a dokumentumban, és válassz módot alul! Választhatsz, hogy kicseréljem a szöveget korrektúrával, vagy egy széljegyzetben (Word Megjegyzés) elemezzem a kijelölt részt.' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [mode, setMode] = useState<'edit' | 'comment' | 'generate'>('edit');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (instructionOverride?: string) => {
    const userInstruction = instructionOverride || input;
    if (!userInstruction.trim() || isSending) return;
    
    if (!instructionOverride) {
      setInput('');
    }
    
    setIsSending(true);
    
    const modeLabel = mode === 'edit' ? '📝 Szerkesztés' : mode === 'comment' ? '💬 Vélemény' : '✨ Generálás';
    const newMessageId = Date.now().toString();
    setMessages(prev => [...prev, { id: newMessageId, role: 'user', content: `[${modeLabel}] ${userInstruction}` }]);

    try {
      if (typeof Word === 'undefined') {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: 'Hiba: A Word API nem érhető el. Kérlek a Wordön belül használd a beépülőt!' }]);
        setIsSending(false);
        return;
      }

      await Word.run(async (context) => {
        const doc = context.document;
        const selection = doc.getSelection();
        const body = doc.body;

        selection.load("text");
        body.load("text");
        doc.load("changeTrackingMode");
        await context.sync();

        if (mode !== 'generate' && (!selection.text || selection.text.trim() === '')) {
          setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: 'Kérlek előbb jelölj ki egy szövegrészt a Word dokumentumban!' }]);
          setIsSending(false);
          return;
        }

        const originalText = selection.text || "";
        // Biztonsági okokból és a hálózat kímélése miatt vágjuk meg a kontextust a kliens oldalon is (kb 30-40 ezer karakter elég)
        const documentContext = body.text ? body.text.substring(0, 40000) : "";
        
        const loadingId = Date.now().toString() + 'load';
        setMessages(prev => [...prev, { id: loadingId, role: 'assistant', content: '', isLoading: true }]);

        const replaceLoadingMessage = (role: Message['role'], content: string) => {
          setMessages(prev => prev.map(m =>
            m.id === loadingId
              ? { id: loadingId, role, content }
              : m
          ));
        };

        // Hívjuk meg a saját backendünket a szolgáltatáson keresztül streaminggel
        let newText: string;
        try {
          newText = await editDocumentTextStream(
            originalText,
            userInstruction,
            documentContext,
            mode,
            (chunk) => {
              // Frissítsük az UI-t folyamatosan, ahogy jönnek a szavak
              setMessages(prev => prev.map(m =>
                m.id === loadingId
                  ? { ...m, content: m.content + chunk, isLoading: false }
                  : m
              ));
            }
          );
        } catch (aiError) {
          // Hibás vagy félbeszakadt válasz esetén a dokumentumhoz nem nyúlunk
          const detail = aiError instanceof Error ? aiError.message : '';
          replaceLoadingMessage('system', `Nem sikerült választ kapni az AI-tól, a dokumentumot nem módosítottam. Kérlek próbáld újra.${detail ? `\n(${detail})` : ''}`);
          return;
        }

        if (!newText.trim()) {
          replaceLoadingMessage('system', 'Az AI üres választ adott, ezért nem módosítottam a dokumentumot. Kérlek próbáld újra.');
          return;
        }

        try {
          if (mode === 'comment') {
            // Széljegyzet (Word Comment) beszúrása
            selection.insertComment(newText);
            await context.sync();
          } else if (mode === 'generate') {
            // Beszúrás a kurzorhoz (ha van kijelölés, akkor cseréli azt, ha nincs, beszúrja)
            selection.insertText(newText, "Replace");
            await context.sync();
          } else {
            // Szerkesztés korrektúrával (Track Changes), utána visszaállítjuk a felhasználó eredeti beállítását
            const previousTrackingMode = doc.changeTrackingMode;
            doc.changeTrackingMode = "TrackAll";
            try {
              selection.insertText(newText, "Replace");
              await context.sync();
            } finally {
              doc.changeTrackingMode = previousTrackingMode;
              await context.sync();
            }
          }

          replaceLoadingMessage('assistant', mode === 'comment' ? '✅ A véleményezést beszúrtam a margóra (Megjegyzésként).' : mode === 'generate' ? '✅ A szöveget beszúrtam a dokumentumba!' : '✅ A szöveget kicseréltem! Ellenőrizd a korrektúrát a dokumentumban.');
        } catch (writeError) {
          console.error("Write error in Word:", writeError);
          replaceLoadingMessage('system', 'Kész lettem volna a válasszal, de nem tudtam beszúrni a dokumentumba. Esetleg írásvédett a dokumentum, vagy zárolt részre kattintottál?');
        }
      });

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: 'Hiba történt a művelet során. Kérlek próbáld újra.' }]);
    } finally {
      setIsSending(false);
    }
  };

  const currentPresets = mode === 'edit' 
    ? ['Javítsd a helyesírást', 'Tedd hivatalosabbá', 'Rövidítsd le']
    : mode === 'comment'
    ? ['Kockázatok keresése', 'Magyarázd el egyszerűen', 'Mi hiányzik belőle?']
    : ['Titoktartási záradék (NDA)', 'Vis maior záradék', 'Fizetési feltételek'];

  return (
    <div className="h-screen bg-neutral-50 flex flex-col font-sans text-neutral-900">
      {/* Header */}
      <div className="bg-blue-600 px-4 py-4 text-white shrink-0 shadow-md z-10">
        <h1 className="text-lg font-bold flex items-center">
          <PenTool className="w-5 h-5 mr-2" />
          Word Writer
        </h1>
        <p className="text-blue-100 text-xs mt-1">Szerkessz, véleményezz, vagy generálj!</p>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm
                ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 
                  msg.role === 'system' ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-none' : 
                  'bg-white text-neutral-800 border border-neutral-200 rounded-bl-none'}`}
            >
              {msg.role === 'system' && <AlertCircle className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />}
              {msg.isLoading && <Loader2 className="w-4 h-4 inline-block mr-2 animate-spin text-blue-600" />}
              <span className="whitespace-pre-wrap">{msg.content}</span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 bg-white border-t border-neutral-200 shrink-0">
        
        {/* Mode Toggle */}
        <div className="flex space-x-1 mb-3 bg-neutral-100 p-1 rounded-lg w-full">
          <button 
            onClick={() => setMode('edit')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'edit' ? 'bg-white shadow text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            📝 Szerkesztés
          </button>
          <button 
            onClick={() => setMode('comment')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'comment' ? 'bg-white shadow text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            💬 Vélemény
          </button>
          <button 
            onClick={() => setMode('generate')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'generate' ? 'bg-white shadow text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            ✨ Generálás
          </button>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mb-3">
          {currentPresets.map((preset) => (
            <button
              key={preset}
              onClick={() => handleSend(preset)}
              disabled={isSending}
              className="px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-200 rounded-full transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="flex items-end space-x-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Kijelöltem a szöveget. Csináld azt vele, hogy..."
            className="flex-1 max-h-32 min-h-[44px] p-2.5 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none bg-neutral-50"
            rows={1}
          />
          <button
            onClick={() => handleSend()}
            disabled={isSending || !input.trim()}
            className="w-11 h-11 shrink-0 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl transition-colors"
          >
            <Send className="w-5 h-5 ml-1" />
          </button>
        </div>
        <p className="text-[10px] text-center text-neutral-400 mt-2">Nyomj Entert a küldéshez</p>
      </div>
    </div>
  );
}
