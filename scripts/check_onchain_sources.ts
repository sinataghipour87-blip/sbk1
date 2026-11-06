import {
  isHealthySourcePingSet,
  isValidSolanaMainnetGenesisHash,
  isValidXrpMainnetNetworkId,
  listPublicWhaleSources,
  ONCHAIN_SOURCE_CONFIG,
  requestPublicWhaleSourceJson,
  scanPublicWhaleAsset,
  type PublicWhaleSource,
} from '../src/services/publicWhaleObservationPoller';
import { getWhaleSourceOperator, type QuorumAsset } from '../src/services/whaleConsensusCandidateRegistry';

interface ProbeResult {
  source: PublicWhaleSource;
  pings: number;
  averageMs: number | null;
  maximumMs: number | null;
  heightSamples: number[];
  height: number | null;
  health: boolean;
  blockRead: string;
  details: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.floor((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function rpcResult(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value.result) ? value.result : null;
}

function rpcValue(value: unknown): unknown {
  return isRecord(value) ? value.result : undefined;
}

async function checkSource(source: PublicWhaleSource): Promise<ProbeResult> {
  const latencies: number[] = [];
  const heightSamples: number[] = [];
  const details: string[] = [];
  const baseUrl = source.urls[0];
  const request = (
    suffix = '',
    payload?: unknown,
    timeoutMs: number = ONCHAIN_SOURCE_CONFIG.healthPingTimeoutMs,
  ) => requestPublicWhaleSourceJson(
    { ...source, urls: [`${baseUrl.replace(/\/+$/, '')}${suffix}`] },
    payload,
    fetch,
    { timeoutMs, retries: false },
  );
  const capture = async <T>(run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      details.push(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const headHeight = (response: unknown): number => {
    if (source.asset === 'BTC') {
      const height = typeof response === 'string' ? Number(response) : response;
      return typeof height === 'number' && Number.isSafeInteger(height) && height > 0
        ? height
        : Number.NaN;
    }
    const result = rpcValue(response);
    if (source.asset === 'XRP') {
      const current = isRecord(result)
        ? result.ledger_current_index ?? result.ledger_index
        : undefined;
      return Number.isSafeInteger(Number(current)) ? Number(current) : Number.NaN;
    }
    const value = result;
    if (source.asset === 'SOL' && typeof value === 'number' && Number.isSafeInteger(value)) {
      return value;
    }
    if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) {
      return Number.parseInt(value, 16);
    }
    return Number.NaN;
  };

  for (let attempt = 0; attempt < ONCHAIN_SOURCE_CONFIG.healthPingAttempts; attempt += 1) {
    const startedAtMs = Date.now();
    try {
      let response: unknown;
      if (source.asset === 'BTC') {
        response = await request('/blocks/tip/height');
      } else {
        const method = source.asset === 'SOL'
          ? 'getSlot'
          : source.asset === 'XRP'
            ? 'ledger_current'
            : 'eth_blockNumber';
        const params = source.asset === 'SOL'
          ? [{ commitment: 'finalized' }]
          : source.asset === 'XRP'
            ? []
            : [];
        response = await request('', { jsonrpc: '2.0', id: attempt + 1, method, params });
      }
      const height = headHeight(response);
      if (Number.isSafeInteger(height) && height > 0) heightSamples.push(height);
      else details.push(`Invalid ${source.asset} health height response.`);
    } catch (error) {
      details.push(error instanceof Error ? error.message : String(error));
    } finally {
      latencies.push(Date.now() - startedAtMs);
    }
  }

  const height = heightSamples.length > 0 ? median(heightSamples) : null;
  let chainGate = true;
  let validatedXrpLedger: number | null = null;
  if (source.asset === 'SOL') {
    const genesis = await capture(() => request('', {
      jsonrpc: '2.0',
      id: 'genesis',
      method: 'getGenesisHash',
      params: [],
    }));
    const genesisHash = rpcValue(genesis);
    chainGate = isValidSolanaMainnetGenesisHash(genesisHash);
    if (!chainGate) details.push('Mainnet genesis hash did not validate.');
  } else if (source.asset === 'XRP') {
    const [serverInfo, current, validated] = await Promise.all([
      capture(() => request('', {
        method: 'server_info',
        params: [{}],
      })),
      capture(() => request('', {
        method: 'ledger_current',
        params: [],
      })),
      capture(() => request('', {
        method: 'ledger',
        params: [{ ledger_index: 'validated', transactions: false }],
      })),
    ]);
    const info = rpcResult(serverInfo);
    const server = info && isRecord(info.info) ? info.info : info;
    const networkId = server?.network_id;
    const currentResult = rpcResult(current);
    const ledger = rpcResult(validated)?.ledger;
    const currentValue = isRecord(currentResult)
      ? currentResult.ledger_current_index ?? currentResult.ledger_index
      : undefined;
    const currentIndex = Number(currentValue);
    const validatedIndex = isRecord(ledger) ? Number(ledger.ledger_index) : Number.NaN;
    const currentValid = Number.isSafeInteger(currentIndex);
    const validatedValid = Number.isSafeInteger(validatedIndex);
    const lag = currentValid && validatedValid ? currentIndex - validatedIndex : null;
    validatedXrpLedger = validatedValid ? validatedIndex : null;
    const reasons: string[] = [];
    if (!isValidXrpMainnetNetworkId(networkId)) reasons.push('network_id is not 0');
    if (!currentValid) reasons.push('current ledger index is invalid');
    if (!validatedValid) reasons.push('validated ledger index is invalid');
    if (lag !== null && currentIndex < validatedIndex) reasons.push('current is below validated');
    if (lag !== null && lag > ONCHAIN_SOURCE_CONFIG.maxXrpLedgerLag) {
      reasons.push(`lag exceeds ${ONCHAIN_SOURCE_CONFIG.maxXrpLedgerLag}`);
    }
    chainGate = reasons.length === 0;
    if (!chainGate) {
      details.push(
        `XRPL gate rejected: network_id=${String(networkId)}, current=${currentValid ? currentIndex : String(currentValue ?? 'invalid')}, validated=${validatedValid ? validatedIndex : 'invalid'}, lag=${lag ?? 'invalid'}; reason=${reasons.join(', ')}.`,
      );
    }
  }

  const pingHealthy = isHealthySourcePingSet(latencies) && heightSamples.length ===
    ONCHAIN_SOURCE_CONFIG.healthPingAttempts;
  if (!pingHealthy) details.push('Health requires 5/5 valid pings, average <3s, and no ping >5s.');

  let blockRead = 'NO';
  const selectedHeight = source.asset === 'XRP' ? validatedXrpLedger : height;
  if (selectedHeight !== null && selectedHeight !== undefined) {
    if (source.asset === 'BTC') {
      const blockHeight = Math.max(1, selectedHeight - 1);
      const hashValue = await capture(() => request(`/block-height/${blockHeight}`));
      const hash = typeof hashValue === 'string' && /^[a-f0-9]{64}$/i.test(hashValue)
        ? hashValue
        : null;
      if (hash) {
        const metadata = await capture(() => request(`/block/${hash}`));
        const txCount = isRecord(metadata) && Number.isSafeInteger(metadata.tx_count)
          ? Number(metadata.tx_count)
          : null;
        const completeHeader = isRecord(metadata) && metadata.id === hash &&
          metadata.height === blockHeight &&
          Number.isSafeInteger(metadata.timestamp) &&
          txCount !== null && txCount > 0;
        if (completeHeader && txCount !== null) {
          let transactionCount = 0;
          const transactionIds = new Set<string>();
          let complete = true;
          for (let pageIndex = 0; transactionCount < txCount; pageIndex += 1) {
            if (pageIndex >= ONCHAIN_SOURCE_CONFIG.maxBtcTransactionPages) {
              complete = false;
              details.push('BTC transaction page limit exceeded.');
              break;
            }
            const pagePath = transactionCount === 0
              ? `/block/${hash}/txs`
              : `/block/${hash}/txs/${transactionCount}`;
            const page = await capture(() => request(pagePath));
            if (!Array.isArray(page) || page.length === 0 ||
                !page.every((tx) => isRecord(tx) && typeof tx.txid === 'string') ||
                page.length > txCount - transactionCount ||
                page.some((tx) => transactionIds.has(String(tx.txid)))) {
              complete = false;
              break;
            }
            for (const tx of page) transactionIds.add(String(tx.txid));
            transactionCount += page.length;
          }
          blockRead = complete && transactionCount === txCount
            ? `YES (${transactionCount} tx)`
            : `PARTIAL ${transactionCount}/${txCount}`;
          if (!complete || transactionCount !== txCount) {
            details.push(`incomplete block: got ${transactionCount} of ${txCount}`);
          }
        } else {
          details.push('BTC block hash, height, timestamp, or transaction metadata did not validate.');
        }
      } else {
        details.push('Could not resolve a valid BTC block hash.');
      }
    } else if (source.asset === 'SOL') {
      for (let offset = 0; offset < 10 && blockRead === 'NO'; offset += 1) {
        const block = await capture(() => request('', {
          jsonrpc: '2.0',
          id: 'full-block',
          method: 'getBlock',
          params: [selectedHeight - offset, {
            commitment: 'finalized',
            encoding: 'jsonParsed',
            transactionDetails: 'full',
            rewards: false,
            maxSupportedTransactionVersion: 1,
          }],
        }, source.blockTimeoutMs ?? ONCHAIN_SOURCE_CONFIG.requestTimeoutMs));
        const value = rpcValue(block);
        if (isRecord(value) && typeof value.blockhash === 'string' &&
            /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.blockhash) &&
            Number.isSafeInteger(value.blockTime) &&
            Array.isArray(value.transactions) &&
            value.transactions.every((tx) => isRecord(tx) && isRecord(tx.transaction) &&
              Array.isArray(tx.transaction.signatures) && isRecord(tx.transaction.message) &&
              Array.isArray(tx.transaction.message.instructions))) {
          blockRead = `YES (${value.transactions.length} tx)`;
        }
      }
      if (blockRead === 'NO') details.push('No complete finalized Solana block was returned.');
    } else if (source.asset === 'XRP') {
      const response = await capture(() => request('', {
        method: 'ledger',
        params: [{
          ledger_index: selectedHeight,
          transactions: true,
          expand: true,
        }],
      }));
      const ledger = rpcResult(response)?.ledger;
      if (isRecord(ledger) && /^[a-f0-9]{64}$/i.test(String(ledger.ledger_hash)) &&
          Number(ledger.ledger_index) === selectedHeight &&
          Number.isSafeInteger(Number(ledger.close_time)) &&
          Array.isArray(ledger.transactions) &&
          ledger.transactions.every((tx) => isRecord(tx) && /^[a-f0-9]{64}$/i.test(String(tx.hash)))) {
        blockRead = `YES (${ledger.transactions.length} tx)`;
      } else {
        details.push('XRPL validated ledger hash, index, close time, or full transactions did not validate.');
      }
    } else {
      const finalityDepth = source.asset === 'ETH' ? 12 : 15;
      const blockHeight = Math.max(1, selectedHeight - finalityDepth);
      const response = await capture(() => request('', {
        jsonrpc: '2.0',
        id: 'full-block',
        method: 'eth_getBlockByNumber',
        params: [`0x${blockHeight.toString(16)}`, true],
      }));
      const block = rpcValue(response);
      const blockNumber = isRecord(block) && typeof block.number === 'string'
        ? Number.parseInt(block.number, 16)
        : Number.NaN;
      const timestamp = isRecord(block) && typeof block.timestamp === 'string'
        ? Number.parseInt(block.timestamp, 16)
        : Number.NaN;
      if (isRecord(block) && blockNumber === blockHeight &&
          typeof block.hash === 'string' && /^0x[a-f0-9]{64}$/i.test(block.hash) &&
          Number.isSafeInteger(timestamp) && Array.isArray(block.transactions) &&
          block.transactions.every((tx) => isRecord(tx) && typeof tx.hash === 'string')) {
        blockRead = `YES (${block.transactions.length} tx)`;
      } else {
        details.push('EVM block number, hash, timestamp, or full transaction list did not validate.');
      }
    }
  }

  const averageMs = latencies.length === ONCHAIN_SOURCE_CONFIG.healthPingAttempts
    ? latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
    : null;
  const maximumMs = latencies.length > 0 ? Math.max(...latencies) : null;
  return {
    source,
    pings: heightSamples.length,
    averageMs,
    maximumMs,
    heightSamples,
    height,
    health: pingHealthy && chainGate,
    blockRead,
    details,
  };
}

const assets: QuorumAsset[] = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'];
const sourceList = listPublicWhaleSources();
const scannerCycles = await Promise.all(assets.map(async (asset) => {
  const startedAtMs = Date.now();
  try {
    const observations = await scanPublicWhaleAsset(asset, Date.now(), 1);
    return { asset, cycleMs: Date.now() - startedAtMs, observations: observations.length, error: '' };
  } catch (error) {
    return {
      asset,
      cycleMs: Date.now() - startedAtMs,
      observations: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}));
console.table(scannerCycles.map((cycle) => ({
  asset: cycle.asset,
  scannerCycleMs: cycle.cycleMs,
  observations: cycle.observations,
  result: cycle.error ? 'UNAVAILABLE' : 'SCANNED',
})));
for (const cycle of scannerCycles) {
  const log = cycle.cycleMs > ONCHAIN_SOURCE_CONFIG.maxScanCycleMs ? console.warn : console.info;
  log(
    `[check_onchain_sources] ${cycle.asset} scanner cycle: ${cycle.cycleMs}ms.${
      cycle.cycleMs > ONCHAIN_SOURCE_CONFIG.maxScanCycleMs ? ' WARNING: exceeded 300s target.' : ''
    }${cycle.error ? ` ${cycle.error}` : ''}`,
  );
}
if (scannerCycles.some(({ error }) => error.length > 0)) process.exitCode = 1;

const probeCycles = await Promise.all(assets.map(async (asset) => {
  const startedAtMs = Date.now();
  const results = await Promise.all(
    sourceList.filter((source) => source.asset === asset).map(checkSource),
  );
  const medianHeights = new Map<string, number[]>();
  for (const result of results) {
    const operatorId = getWhaleSourceOperator(asset, result.source.sourceId);
    if (!result.health || !result.source.independent || !operatorId || result.height === null) continue;
    const values = medianHeights.get(operatorId) ?? [];
    values.push(result.height);
    medianHeights.set(operatorId, values);
  }
  const heightBaseline = median([...medianHeights.values()].map(median));
  const maxLag = asset === 'SOL'
    ? ONCHAIN_SOURCE_CONFIG.maxSolanaSlotLag
    : asset === 'XRP'
      ? ONCHAIN_SOURCE_CONFIG.maxXrpLedgerLag
      : ONCHAIN_SOURCE_CONFIG.maxBlockHeightLag;
  for (const result of results) {
    if (result.height === null || !Number.isFinite(heightBaseline)) continue;
    const lag = Math.abs(result.height - heightBaseline);
    if (lag > maxLag) {
      result.health = false;
      const reason = `${lag} ${asset === 'SOL' ? 'slots' : asset === 'XRP' ? 'ledgers' : 'blocks'} from source median; excluded.`;
      result.details.push(reason);
      console.warn(`[check_onchain_sources] ${asset}/${result.source.sourceId}: ${reason}`);
    }
  }
  const cycleMs = Date.now() - startedAtMs;
  const log = cycleMs > ONCHAIN_SOURCE_CONFIG.maxScanCycleMs ? console.warn : console.info;
  log(
    `[check_onchain_sources] ${asset} health/block probe cycle: ${cycleMs}ms.${
      cycleMs > ONCHAIN_SOURCE_CONFIG.maxScanCycleMs ? ' WARNING: exceeded 300s.' : ''
    }`,
  );
  return { asset, results, cycleMs };
}));

console.table(probeCycles.flatMap(({ asset, results }) => results.map((result) => ({
  asset,
  sourceId: result.source.sourceId,
  operatorId: result.source.operatorId ?? 'UNVERIFIED BACKUP',
  independent: result.source.independent,
  pings: `${result.pings}/${ONCHAIN_SOURCE_CONFIG.healthPingAttempts}`,
  averageMs: result.averageMs === null ? '-' : Math.round(result.averageMs),
  maximumMs: result.maximumMs ?? '-',
  height: result.height ?? '-',
  health: result.health ? 'HEALTHY' : 'FLAG',
  blockRead: result.blockRead,
}))));

for (const { asset, results } of probeCycles) {
  const healthyOperators = new Set(results.flatMap((result) => {
    const operatorId = getWhaleSourceOperator(asset, result.source.sourceId);
    return result.health && result.source.independent && operatorId ? [operatorId] : [];
  }));
  const fullBlockOperators = new Set(results.flatMap((result) => {
    const operatorId = getWhaleSourceOperator(asset, result.source.sourceId);
    return result.health && result.source.independent && operatorId &&
      result.blockRead.startsWith('YES') ? [operatorId] : [];
  }));
  console.info(
    `[check_onchain_sources] ${asset}: ${healthyOperators.size} independent operators pass health gates; ${fullBlockOperators.size} also returned a complete block/ledger.`,
  );
  if (healthyOperators.size < 2 || fullBlockOperators.size < 2) {
    console.error(
      `[check_onchain_sources] ${asset} has fewer than two independent healthy full-data sources; scanner quorum is unavailable.`,
    );
    process.exitCode = 1;
  }
  for (const result of results) {
    if (!result.health || !result.blockRead.startsWith('YES')) {
      console.warn(
        `[check_onchain_sources] ${asset}/${result.source.sourceId}: ${result.details.join(' | ') || 'full block/ledger read was not complete.'}`,
      );
    }
  }
}
