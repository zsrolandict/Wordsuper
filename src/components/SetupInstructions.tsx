import React, { useState } from 'react';
import { generateManifest } from '../manifest';
import { Copy, Check, FileDown } from 'lucide-react';

export default function SetupInstructions() {
  const [copied, setCopied] = useState(false);
  const manifestXml = generateManifest(window.location.origin);

  const handleCopy = () => {
    navigator.clipboard.writeText(manifestXml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([manifestXml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manifest.xml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-neutral-50 p-6 md:p-12 font-sans text-neutral-900">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        
        {/* Header */}
        <div className="bg-blue-600 p-8 text-white">
          <h1 className="text-3xl font-bold mb-2">Word Writer Add-in</h1>
          <p className="text-blue-100 text-lg">
            This application is designed to run directly inside Microsoft Word as a Taskpane Add-in.
          </p>
        </div>

        {/* Content */}
        <div className="p-8 space-y-8">
          
          <section>
            <h2 className="text-xl font-bold text-neutral-800 mb-4 flex items-center">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-sm mr-3">1</span>
              Töltsd le a Manifest fájlt
            </h2>
            <p className="text-neutral-600 mb-4 leading-relaxed">
              Ahhoz, hogy ezt az alkalmazást a saját Microsoft Wordödben tudd használni, szükséged lesz az alábbi XML konfigurációs (Manifest) fájlra. Ez mondja meg a Wordnek, hogy honnan töltse be a beépülőt.
            </p>
            
            <div className="bg-neutral-900 rounded-xl overflow-hidden shadow-inner">
              <div className="flex justify-between items-center px-4 py-2 bg-neutral-800 border-b border-neutral-700">
                <span className="text-xs font-mono text-neutral-400">manifest.xml</span>
                <div className="flex space-x-2">
                  <button 
                    onClick={handleCopy}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-md bg-neutral-700 hover:bg-neutral-600 text-white text-xs transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Másolva!' : 'Másolás'}</span>
                  </button>
                  <button 
                    onClick={handleDownload}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs transition-colors"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span>Letöltés</span>
                  </button>
                </div>
              </div>
              <pre className="p-4 overflow-x-auto text-sm text-neutral-300 font-mono max-h-64">
                <code>{manifestXml}</code>
              </pre>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-800 mb-4 flex items-center">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-sm mr-3">2</span>
              Telepítés (Sideloading) a Wordbe
            </h2>
            <div className="space-y-4 text-neutral-600">
              <p>Hogyan próbáld ki a beépülőt asztali környezetben:</p>
              
              <div className="bg-neutral-50 p-5 rounded-lg border border-neutral-200">
                <h3 className="font-semibold text-neutral-800 mb-2">Windows (Office asztali verzió)</h3>
                <ul className="list-decimal pl-5 space-y-2 text-sm">
                  <li>Hozz létre egy mappát a gépeden (pl. <code>C:\WordAddins</code>), és másold bele a letöltött <code>manifest.xml</code>-t.</li>
                  <li>Kattints jobb gombbal a mappára &gt; <strong>Tulajdonságok</strong> &gt; <strong>Megosztás</strong> fül, és oszd meg a mappát.</li>
                  <li>Nyisd meg a Wordöt, majd hozz létre egy új üres dokumentumot.</li>
                  <li>Menj a <strong>Fájl</strong> &gt; <strong>Beállítások</strong> &gt; <strong>Adatvédelmi központ</strong> &gt; <strong>Adatvédelmi központ beállításai...</strong> &gt; <strong>Megbízható bővítménykatalógusok</strong> menüpontra.</li>
                  <li>Írd be a megosztott mappa hálózati elérési útját (pl. <code>\\SzamitogepNeved\WordAddins</code>) a Katalógus URL-címéhez, kattints a <strong>Katalógus felvétele</strong> gombra, majd pipáld be a "Megjelenítés a menüben" opciót. Kattints az OK-ra, majd indítsd újra a Wordöt.</li>
                  <li>A Wordben menj a <strong>Beszúrás</strong> &gt; <strong>Saját bővítmények</strong> menüpontra, válaszd a <strong>Megosztott mappa</strong> fület, és ott lesz a Word Writer Add-in!</li>
                </ul>
              </div>

              <div className="bg-neutral-50 p-5 rounded-lg border border-neutral-200">
                <h3 className="font-semibold text-neutral-800 mb-2">Office on the Web (Word Online)</h3>
                <ul className="list-decimal pl-5 space-y-2 text-sm">
                  <li>Nyisd meg a <a href="https://word.office.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Word Online</a>-t, és hozz létre egy új dokumentumot.</li>
                  <li>Kattints a <strong>Beszúrás</strong> fülre, majd válaszd a <strong>Bővítmények</strong> gombot.</li>
                  <li>Kattints a <strong>Saját bővítmények kezelése</strong> lehetőségre, majd a <strong>Saját bővítmény feltöltése</strong> gombra.</li>
                  <li>Tallózd ki a letöltött <code>manifest.xml</code> fájlt. A beépülő egyből betöltődik az oldalsávba!</li>
                </ul>
              </div>
              
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
