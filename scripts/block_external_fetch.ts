const originalFetch = globalThis.fetch.bind(globalThis);
const allowedHosts = new Set(['127.0.0.1', '::1', 'localhost']);

globalThis.fetch = async (input, init) => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl);
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`External fetch blocked by the legacy-route integration test: ${url.hostname}`);
  }
  return originalFetch(input, init);
};
