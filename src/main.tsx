import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Az Office API inicializálását (Office.onReady) az App kezeli, így akkor is renderelünk, ha az office.js nem töltött be
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
