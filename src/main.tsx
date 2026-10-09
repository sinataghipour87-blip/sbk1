import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  // Global fetch interceptor to automatically inject x-admin-token for secure server routes
  const originalFetch = window.fetch;

  const interceptedFetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    if (url.includes('/api/exchange') || url.includes('/api/live')) {
        const token = localStorage.getItem('admin_token') || '';
        init = init || {};
        init.headers = init.headers || {};
        if (init.headers instanceof Headers) {
            init.headers.set('x-admin-token', token);
        } else if (Array.isArray(init.headers)) {
            // Find if x-admin-token is already in array headers
            const existingIdx = init.headers.findIndex(([k]) => k.toLowerCase() === 'x-admin-token');
            if (existingIdx !== -1) {
                init.headers[existingIdx] = ['x-admin-token', token];
            } else {
                init.headers.push(['x-admin-token', token]);
            }
        } else {
            (init.headers as any)['x-admin-token'] = token;
        }
    }
    return originalFetch(input, init);
  };

  try {
    (window as any).fetch = interceptedFetch;
  } catch (err) {
    try {
      Object.defineProperty(window, 'fetch', {
        value: interceptedFetch,
        writable: true,
        configurable: true,
        enumerable: true
      });
    } catch (definePropertyError) {
      try {
        (globalThis as any).fetch = interceptedFetch;
      } catch (globalThisError) {
        console.warn("Could not intercept fetch globally due to secure sandbox constraints.", globalThisError);
      }
    }
  }

  window.addEventListener('error', (event) => {
    const msg = typeof event?.message === 'string' ? event.message : (typeof event === 'string' ? event : '');
    if (
      msg.includes('ResizeObserver loop completed with undelivered notifications') ||
      msg.includes('ResizeObserver loop limit exceeded')
    ) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (
      event.reason &&
      (String(event.reason).includes('WebSocket') ||
        (event.reason.message && String(event.reason.message).includes('WebSocket')) ||
        String(event.reason).includes('ResizeObserver') ||
        (event.reason.message && String(event.reason.message).includes('ResizeObserver')))
    ) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
