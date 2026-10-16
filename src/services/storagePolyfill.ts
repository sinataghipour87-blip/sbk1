// In sandboxed iframe environments (such as AI Studio preview or third-party partitioned storage),
// accessing window.localStorage may throw a SecurityError.
// This polyfill ensures safe fallback to in-memory storage so the UI initializes without crashing.

if (typeof window !== 'undefined') {
  try {
    const testKey = '__sbk1_storage_probe__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
  } catch {
    const memStore = new Map<string, string>();
    const polyfillStorage = {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memStore.set(k, String(v));
      },
      removeItem: (k: string) => {
        memStore.delete(k);
      },
      clear: () => {
        memStore.clear();
      },
      key: (i: number) => Array.from(memStore.keys())[i] ?? null,
      get length() {
        return memStore.size;
      },
    };
    try {
      Object.defineProperty(window, 'localStorage', {
        value: polyfillStorage,
        configurable: true,
        writable: true,
      });
    } catch {
      try {
        (window as any).localStorage = polyfillStorage;
      } catch {}
    }
  }
}

export {};
