import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { NotificationsProvider } from './lib/NotificationsContext.jsx';
import { LayoutGroup } from 'framer-motion';
import './styles/tailwind.css';
import './styles/auth.css';
import { supabaseReady } from './lib/supabase.js';

window.addEventListener('vite:preloadError', () => {
  // In dev, Vite intentionally returns 504 while bundling deps for the first
  // time (dep optimisation). Keep retrying every 2 s until it's done.
  if (import.meta.env.DEV) {
    setTimeout(() => window.location.reload(), 2000);
    return;
  }
  // In production, use a cooldown to avoid reload loops on genuine errors.
  const KEY = 'mint:chunk-reloaded-at';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last > 10000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }
});

// Wait for Supabase config to be fetched before mounting, so all components
// get an initialized client on first render (avoids "not set" flash).
supabaseReady.finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <LayoutGroup>
      <NotificationsProvider>
        <App />
      </NotificationsProvider>
    </LayoutGroup>
  );
});
