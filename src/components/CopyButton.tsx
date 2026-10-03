import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Copies a text the pane wrote for the user (a cover letter): it is never written into the document */
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not allowed here: the text stays on screen to select by hand
    }
  };
  return (
    <button onClick={copy} className="mt-2 flex items-center text-xs font-medium text-blue-700 hover:text-blue-900">
      {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
      {copied ? 'Kimásolva' : 'Másolás'}
    </button>
  );
}
