import React from 'react';
import { createRoot } from 'react-dom/client';
// Readable content fonts + a pixel face used sparingly for the retro wordmark/accents.
import '@fontsource/press-start-2p/400.css'; // wordmark / big accents ONLY (chunky, readable when large)
import '@fontsource/chivo/400.css'; // UI / labels (clean, highly readable)
import '@fontsource/chivo/700.css';
import '@fontsource/ibm-plex-mono/400.css'; // terminal viewports (crisp, readable)
import '@fontsource/ibm-plex-mono/500.css';
import './index.css';
import { App } from './App';
import { connectWs } from './ws';
import { useStore, applyTheme } from './store';

applyTheme(useStore.getState().theme); // set <html data-theme> before first paint
connectWs();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
