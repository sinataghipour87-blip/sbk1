import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[UI] Application render failed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main dir="rtl" role="alert" className="min-h-screen bg-slate-950 p-6 text-slate-100">
          <section className="mx-auto mt-16 max-w-2xl rounded-2xl border border-rose-800/60 bg-slate-900 p-6">
            <h1 className="text-xl font-bold text-rose-300">بخشی از رابط کاربری اجرا نشد</h1>
            <p className="mt-3 text-sm text-slate-300">
              صفحه را دوباره بارگذاری کنید. اگر خطا تکرار شد، پیام زیر را برای بررسی نگه دارید.
            </p>
            <pre dir="ltr" className="mt-4 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-rose-200">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold hover:bg-rose-600"
            >
              بارگذاری دوباره
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

if (typeof window !== 'undefined') {
  // Global fetch interceptor to automatically inject x-admin-token for secure server routes
  const originalFetch = window.fetch;

  const interceptedFetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    if (url.includes('/api/exchange') || url.includes('/api/live') || url.includes('/api/hunter')) {
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

const root = createRoot(document.getElementById('root')!);
const startupFallback = (
  <StrictMode>
    <main dir="rtl" role="status" className="grid min-h-screen place-content-center gap-3 bg-slate-950 p-6 text-center text-slate-100">
      <strong className="text-xl">در حال راه‌اندازی سامانه تحلیل و معامله</strong>
      <span className="text-slate-400">لطفاً تا بارگذاری کامل رابط کاربری منتظر بمانید.</span>
    </main>
  </StrictMode>
);

root.render(startupFallback);

const startupTimeout = window.setTimeout(() => {
  root.render(
    <main dir="rtl" role="alert" className="grid min-h-screen place-content-center gap-3 bg-slate-950 p-6 text-center text-slate-100">
      <strong className="text-xl text-amber-300">بارگذاری رابط کاربری بیش از حد معمول طول کشیده است</strong>
      <span className="text-slate-300">اتصال سرور و بارگذاری فایل‌های برنامه را بررسی کنید؛ در صورت تکرار، صفحه را دوباره بارگذاری کنید.</span>
      <button type="button" onClick={() => window.location.reload()} className="mx-auto mt-2 rounded-lg bg-emerald-700 px-4 py-2 font-bold hover:bg-emerald-600">
        بارگذاری دوباره
      </button>
    </main>,
  );
}, 20_000);

void import('./App.tsx')
  .then(({ default: App }) => {
    window.clearTimeout(startupTimeout);
    root.render(
      <StrictMode>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    window.clearTimeout(startupTimeout);
    console.error('[UI] Application startup failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    root.render(
      <main dir="rtl" role="alert" className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <section className="mx-auto mt-16 max-w-2xl rounded-2xl border border-rose-800/60 bg-slate-900 p-6">
          <h1 className="text-xl font-bold text-rose-300">رابط کاربری بارگذاری نشد</h1>
          <p className="mt-3 text-sm text-slate-300">اتصال سرور را بررسی کنید. اگر خطا تکرار شد، متن زیر را برای بررسی نگه دارید.</p>
          <pre dir="ltr" className="mt-4 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-rose-200">{message}</pre>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold hover:bg-rose-600">
            بارگذاری دوباره
          </button>
        </section>
      </main>,
    );
  });
