import { Component, StrictMode, useCallback, useEffect, useState, type ErrorInfo, type FormEvent, type ReactNode } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

type AdminTokenErrorReason = 'invalid' | 'connection' | 'unexpected';

class AdminTokenError extends Error {
  constructor(readonly reason: AdminTokenErrorReason) {
    super(reason);
  }
}

async function verifyAdminToken(token: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/live/status', {
      headers: { 'x-admin-token': token },
      cache: 'no-store',
    });
  } catch {
    throw new AdminTokenError('connection');
  }

  if (response.status === 403) throw new AdminTokenError('invalid');
  if (response.status !== 200 && response.status !== 503) throw new AdminTokenError('unexpected');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatMarketDataAge(ageMs: number): string {
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)} seconds ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)} minutes ago`;
  return `${Math.floor(ageMs / 3_600_000)} hours ago`;
}

function DashboardStatusBanner({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [status, setStatus] = useState<{ available: boolean; data: Record<string, unknown> } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refreshStatus = async () => {
      const token = localStorage.getItem('admin_token');
      if (!token) {
        onUnauthorized();
        return;
      }
      try {
        const response = await fetch('/api/live/status', {
          headers: { 'x-admin-token': token },
          cache: 'no-store',
        });
        if (response.status === 403) {
          onUnauthorized();
          return;
        }
        const body: unknown = await response.json();
        if (!isRecord(body)) throw new Error('Invalid dashboard status response.');
        if (!cancelled) setStatus({ available: response.ok, data: body });
      } catch {
        if (!cancelled) setStatus(null);
      }
    };

    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [onUnauthorized]);

  const data = status?.data;
  const freqtrade = isRecord(data?.freqtrade) ? data.freqtrade : null;
  const mode = freqtrade?.dryRun === true
    ? 'DRY-RUN'
    : 'unavailable (dry-run not confirmed)';
  const killSwitch = typeof data?.killSwitchActive === 'boolean'
    ? data.killSwitchActive ? 'engaged' : 'disarmed'
    : 'unavailable';
  const connection = status?.available && freqtrade ? 'yes' : status ? 'no' : 'unavailable';
  const marketAge = typeof data?.marketDataAgeMs === 'number' &&
    Number.isFinite(data.marketDataAgeMs) &&
    data.marketDataAgeMs >= 0
    ? formatMarketDataAge(data.marketDataAgeMs)
    : 'unavailable';
  const productionStatus = isRecord(data?.productionSignalStatus) &&
    data.productionSignalStatus.blocked === true &&
    data.productionSignalStatus.reason === 'CALIBRATED_CONFIDENCE_UNAVAILABLE'
    ? 'blocked (no calibrated probability)'
    : 'unavailable';
  const items = [
    ['حالت / Mode', mode],
    ['کلید توقف / Kill switch', killSwitch],
    ['اتصال Freqtrade / Freqtrade connected', connection],
    ['سن آخرین داده بازار / Last market data age', marketAge],
    ['سیگنال تولید / Production signals', productionStatus],
  ];

  return (
    <section
      dir="rtl"
      aria-label="وضعیت ایمنی / Safety status"
      className="grid grid-cols-1 gap-2 rounded-xl border border-slate-700 bg-slate-950/90 p-3 text-xs text-slate-100 sm:grid-cols-2 xl:grid-cols-5"
    >
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-slate-900 px-3 py-2">
          <div className="text-slate-400">{label}</div>
          <div className="mt-1 font-bold" dir="ltr">{value}</div>
        </div>
      ))}
    </section>
  );
}

function AdminTokenGate({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<'checking' | 'token' | 'ready'>('checking');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem('admin_token');
    setError('The saved admin token was rejected. Enter the correct ADMIN_TOKEN value.');
    setScreen('token');
  }, []);

  useEffect(() => {
    const savedToken = localStorage.getItem('admin_token');
    if (!savedToken) {
      setScreen('token');
      return;
    }
    void verifyAdminToken(savedToken)
      .then(() => setScreen('ready'))
      .catch((reason: unknown) => {
        if (reason instanceof AdminTokenError && reason.reason === 'invalid') {
          localStorage.removeItem('admin_token');
          setError('That admin token was rejected. Check the ADMIN_TOKEN value in your .env file.');
        } else if (reason instanceof AdminTokenError && reason.reason === 'connection') {
          setError('Could not connect to SBK1. Start npm run sbk1, then try again.');
        } else {
          setError('SBK1 returned an unexpected response while checking the admin token.');
        }
        setScreen('token');
      });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await verifyAdminToken(token);
      localStorage.setItem('admin_token', token);
      setToken('');
      setScreen('ready');
    } catch (reason: unknown) {
      if (reason instanceof AdminTokenError && reason.reason === 'invalid') {
        setError('That admin token is incorrect. Check the ADMIN_TOKEN value in your .env file.');
      } else if (reason instanceof AdminTokenError && reason.reason === 'connection') {
        setError('Could not connect to SBK1. Start npm run sbk1, then try again.');
      } else {
        setError('SBK1 returned an unexpected response while checking the admin token.');
      }
    }
  }

  if (screen === 'checking') {
    return <main className="grid min-h-screen place-content-center bg-slate-950 p-6 text-slate-100">Checking dashboard access…</main>;
  }

  if (screen === 'token') {
    return (
      <main dir="rtl" className="grid min-h-screen place-content-center bg-slate-950 p-6 text-slate-100">
        <form onSubmit={(event) => void handleSubmit(event)} className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
          <h1 className="text-xl font-bold">ورود به داشبورد / Dashboard access</h1>
          <label htmlFor="admin-token" className="mt-5 block text-sm font-semibold">
            Enter admin token (it is the ADMIN_TOKEN value in your .env file)
          </label>
          <input
            id="admin-token"
            type="password"
            autoComplete="off"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-3 text-left text-sm text-white"
          />
          {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
          <button type="submit" className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white hover:bg-emerald-600">
            Continue / ادامه
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      <DashboardStatusBanner onUnauthorized={handleUnauthorized} />
      {children}
    </>
  );
}

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <AdminTokenGate>
        <App />
      </AdminTokenGate>
    </RootErrorBoundary>
  </StrictMode>,
);
