import React, { useEffect, useState } from 'react';
import SetupInstructions from './components/SetupInstructions';
import TaskPane from './components/TaskPane';
import { REQUIRED_WORD_API_VERSION } from './manifest';

export default function App() {
  const [isOfficeHost, setIsOfficeHost] = useState<boolean | null>(null);
  const [isWordApiSupported, setIsWordApiSupported] = useState(true);

  useEffect(() => {
    // Determine if we are running inside a Microsoft Office host (Word)
    // The office.js script provides the global `Office` object.
    
    if (typeof Office !== 'undefined' && Office.onReady) {
      Office.onReady((info) => {
        if (info.host === Office.HostType.Word) {
          // Manifests installed before the Requirements element was added still load in older Word versions
          setIsWordApiSupported(Office.context.requirements.isSetSupported('WordApi', REQUIRED_WORD_API_VERSION));
          setIsOfficeHost(true);
        } else {
          setIsOfficeHost(false);
        }
      });
    } else {
      // Fallback if office.js didn't load or isn't present
      const timer = setTimeout(() => {
        setIsOfficeHost(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Show a loading state while checking the environment
  if (isOfficeHost === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (isOfficeHost && !isWordApiSupported) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-6 font-sans text-neutral-800">
        <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm text-sm space-y-2">
          <h1 className="text-base font-bold">Ez a Word-verzió túl régi a TRIPART-hoz</h1>
          <p>A beépülő a megjegyzésekhez és a korrektúrához a Word API {REQUIRED_WORD_API_VERSION}-es verzióját használja, amit ez a Word nem ismer.</p>
          <p>Használd a Microsoft 365-ös Wordöt, a Word 2021-et vagy újabbat, illetve a Word Online-t.</p>
        </div>
      </div>
    );
  }

  // If we are inside Word, show the Add-in UI. Otherwise, show the setup instructions.
  return isOfficeHost ? <TaskPane /> : <SetupInstructions />;
}
