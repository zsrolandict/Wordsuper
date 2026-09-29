import React, { useEffect, useState } from 'react';
import SetupInstructions from './components/SetupInstructions';
import TaskPane from './components/TaskPane';

export default function App() {
  const [isOfficeHost, setIsOfficeHost] = useState<boolean | null>(null);

  useEffect(() => {
    // Determine if we are running inside a Microsoft Office host (Word)
    // The office.js script provides the global `Office` object.
    
    if (typeof Office !== 'undefined' && Office.onReady) {
      Office.onReady((info) => {
        if (info.host === Office.HostType.Word) {
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

  // If we are inside Word, show the Add-in UI. Otherwise, show the setup instructions.
  return isOfficeHost ? <TaskPane /> : <SetupInstructions />;
}
