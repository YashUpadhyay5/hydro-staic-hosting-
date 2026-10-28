import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Global auto-recovery for stale chunk failures across LAN browsers
window.addEventListener('error', (event) => {
  const msg = String(event?.message || '').toLowerCase();
  if (
    msg.includes('dynamically imported module') ||
    msg.includes('unexpected token \'<\'') ||
    msg.includes('loading chunk')
  ) {
    if (!sessionStorage.getItem('hrms_chunk_reload_attempt')) {
      sessionStorage.setItem('hrms_chunk_reload_attempt', 'true');
      if ('caches' in window) {
        caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))).catch(() => {});
      }
      window.location.reload();
    }
  }
});

// Register Cache-First Service Worker for 0ms repeat loading on remote laptops over LAN
if ('serviceWorker' in navigator && !window.location.host.includes('localhost:5174')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update().catch(() => {});
    }).catch((err) => {
      console.warn('Service Worker registration notice:', err);
    });
  });
}

