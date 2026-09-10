import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Várjuk meg az Office API inicializálását mielőtt a React fát renderelnénk
// @ts-ignore
Office.onReady(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
