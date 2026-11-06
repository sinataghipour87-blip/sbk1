import type { QuorumAsset } from './whaleConsensusCandidateRegistry';
import type {
  WalletHistoryActivity,
  WalletHistorySyncResult,
} from './whaleAddressTracker';
import {
  ingestWalletHistory,
  readWalletProfilesDueForHistory,
} from './whaleAddressTracker';

const HISTORY_WINDOW_MS = 90 * 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_HISTORY_PAGES = 20;
const MAX_SOLANA_SIGNATURES = 250;
const MAX_SOLANA_TOKEN_ACCOUNTS = 20;
const XRP_EPOCH_SECONDS = 946_684_800;
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const XRP_RPC = 'https://xrplcluster.com';
const ETH_BLOCKSCOUT = 'https://eth.blockscout.com/api/v2';

interface WalletHistoryPage {
  activities: WalletHistoryActivity[];
  status: 'COMPLETE' | 'PARTIAL';
  source: string;
  coverageFromMs: number;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readJsonResponse(response: Response, hostname: string): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Response from ${hostname} exceeds the safe size limit.`);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Response from ${hostname} exceeds the safe size limit.`);
  }
  return JSON.parse(text) as unknown;
}

function decimalAmount(raw: unknown, decimals: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const places = Number(decimals);
  if (!Number.isSafeInteger(places) || places < 0 || places > 36) return null;
  const amount = Number(raw) / 10 ** places;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function addressesEqual(chain: QuorumAsset, left: string, right: string): boolean {
  if (chain === 'ETH' || chain === 'BNB') return left.toLowerCase() === right.toLowerCase();
  if (chain === 'BTC' && left.toLowerCase().startsWith('bc1') &&
      right.toLowerCase().startsWith('bc1')) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function roleFor(
  chain: QuorumAsset,
  address: string,
  from: string | null,
  to: string | null,
):
  WalletHistoryActivity['role'] {
  const isFrom = from !== null && addressesEqual(chain, address, from);
  const isTo = to !== null && addressesEqual(chain, address, to);
  return isFrom && isTo ? 'SELF' : isFrom ? 'OUTGOING' : isTo ? 'INCOMING' : 'PARTICIPANT';
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}.`);
    return await readJsonResponse(response, new URL(url).host);
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}.`);
    const payload = await readJsonResponse(response, new URL(url).host);
    if (!isRecord(payload) || payload.error !== undefined || !('result' in payload)) {
      throw new Error(`${method} returned an invalid public RPC response.`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}.`);
    return await readJsonResponse(response, new URL(url).host);
  } finally {
    clearTimeout(timeout);
  }
}

function makeActivity(
  address: string,
  chain: QuorumAsset,
  transactionHash: string,
  transferId: string,
  atMs: number,
  role: WalletHistoryActivity['role'],
  activityType: WalletHistoryActivity['activityType'],
  counterpartyAddresses: string[],
  extra: Partial<WalletHistoryActivity> = {},
): WalletHistoryActivity {
  return {
    address,
    chain,
    transactionHash,
    transferId,
    timestampMs: atMs,
    role,
    activityType,
    counterpartyAddresses,
    ...extra,
  };
}

async function fetchBitcoinHistory(
  address: string,
  fromMs: number,
  nowMs: number,
): Promise<WalletHistoryPage> {
  const source = 'mempool.space';
  const activities: WalletHistoryActivity[] = [];
  let cursor: string | null = null;
  let reachedWindowStart = false;
  let exhausted = false;
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const path = cursor
      ? `/address/${encodeURIComponent(address)}/txs/chain/${encodeURIComponent(cursor)}`
      : `/address/${encodeURIComponent(address)}/txs`;
    const payload = await fetchJson(`https://mempool.space/api${path}`);
    if (!Array.isArray(payload)) throw new Error('Bitcoin address-history response is malformed.');
    if (payload.length === 0) {
      exhausted = true;
      break;
    }
    for (const raw of payload) {
      if (!isRecord(raw) || !isRecord(raw.status) ||
          raw.status.confirmed !== true || typeof raw.txid !== 'string' ||
          !Array.isArray(raw.vin) || !Array.isArray(raw.vout)) continue;
      const time = Number(raw.status.block_time) * 1_000;
      if (!Number.isSafeInteger(time) || time <= 0 || time > nowMs) continue;
      if (time < fromMs) {
        reachedWindowStart = true;
        continue;
      }
      const counterparties = new Set<string>();
      for (const input of raw.vin) {
        if (isRecord(input) && isRecord(input.prevout) &&
            typeof input.prevout.scriptpubkey_address === 'string' &&
            !addressesEqual('BTC', input.prevout.scriptpubkey_address, address)) {
          counterparties.add(input.prevout.scriptpubkey_address);
        }
      }
      for (const output of raw.vout) {
        if (isRecord(output) && typeof output.scriptpubkey_address === 'string' &&
            !addressesEqual('BTC', output.scriptpubkey_address, address)) {
          counterparties.add(output.scriptpubkey_address);
        }
      }
      const inputs = raw.vin.flatMap((input) => {
        if (!isRecord(input) || !isRecord(input.prevout) ||
            typeof input.prevout.scriptpubkey_address !== 'string' ||
            !addressesEqual('BTC', input.prevout.scriptpubkey_address, address)) return [];
        const amount = positiveNumber(input.prevout.value);
        if (!amount) return [];
        return [amount];
      });
      const outputRows = raw.vout as unknown[];
      const outputs = outputRows.flatMap((output, index) => {
        if (!isRecord(output) || typeof output.scriptpubkey_address !== 'string' ||
            !addressesEqual('BTC', output.scriptpubkey_address, address)) return [];
        const amount = positiveNumber(output.value);
        if (!amount) return [];
        return [{ amount, index }];
      });
      for (let index = 0; index < inputs.length; index += 1) {
        const singleOutputAmount = outputRows.length === 1 && isRecord(outputRows[0])
          ? positiveNumber(outputRows[0].value)
          : null;
        activities.push(makeActivity(
          address, 'BTC', raw.txid,
          outputRows.length === 1 ? 'vout:0' : `history:input:${index}`,
          time, 'OUTGOING', 'NATIVE_TRANSFER', [...counterparties],
          { amountNative: (singleOutputAmount ?? inputs[index]) / 1e8 },
        ));
      }
      for (const output of outputs) {
        activities.push(makeActivity(
          address, 'BTC', raw.txid, `vout:${output.index}`, time, 'INCOMING',
          'NATIVE_TRANSFER', [...counterparties], { amountNative: output.amount / 1e8 },
        ));
      }
      if (inputs.length === 0 && outputs.length === 0) {
        activities.push(makeActivity(
          address, 'BTC', raw.txid, 'history:transaction', time, 'PARTICIPANT',
          'CONTRACT_INTERACTION', [],
        ));
      }
    }
    const last = payload[payload.length - 1];
    if (!isRecord(last) || typeof last.txid !== 'string' || last.txid === cursor) {
      throw new Error('Bitcoin address-history pagination cursor is invalid.');
    }
    cursor = last.txid;
    if (reachedWindowStart) break;
    if (payload.length < 25) {
      exhausted = true;
      break;
    }
  }
  const complete = reachedWindowStart || exhausted;
  return {
    activities,
    status: complete ? 'COMPLETE' : 'PARTIAL',
    source,
    coverageFromMs: fromMs,
    ...(!complete ? { error: `History scan reached the ${MAX_HISTORY_PAGES}-page safety limit.` } : {}),
  };
}

function appendPageParams(url: URL, params: unknown): void {
  if (!isRecord(params)) return;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') {
      url.searchParams.set(key, String(value));
    }
  }
}

async function fetchBlockscoutItems(
  endpoint: string,
  fromMs: number,
  parseItem: (item: unknown) => { timestamp: number | null; activities: WalletHistoryActivity[] },
): Promise<{ activities: WalletHistoryActivity[]; complete: boolean }> {
  let nextParams: unknown = null;
  let reachedWindowStart = false;
  let exhausted = false;
  const activities: WalletHistoryActivity[] = [];
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const url = new URL(`${ETH_BLOCKSCOUT}${endpoint}`);
    if (nextParams !== null) appendPageParams(url, nextParams);
    const payload = await fetchJson(url.toString());
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new Error(`Blockscout ${endpoint} history response is malformed.`);
    }
    for (const item of payload.items) {
      const parsed = parseItem(item);
      if (parsed.timestamp !== null && parsed.timestamp < fromMs) {
        reachedWindowStart = true;
        continue;
      }
      activities.push(...parsed.activities);
    }
    nextParams = payload.next_page_params ?? null;
    if (reachedWindowStart) break;
    if (nextParams === null) {
      exhausted = true;
      break;
    }
  }
  return { activities, complete: reachedWindowStart || exhausted };
}

async function fetchEthereumHistory(
  address: string,
  fromMs: number,
  nowMs: number,
): Promise<WalletHistoryPage> {
  const normalizedAddress = address.toLowerCase();
  const txPath = `/addresses/${encodeURIComponent(address)}/transactions`;
  const tokenPath = `/addresses/${encodeURIComponent(address)}/token-transfers`;
  const native = await fetchBlockscoutItems(txPath, fromMs, (raw) => {
    if (!isRecord(raw) || typeof raw.hash !== 'string') return { timestamp: null, activities: [] };
    const atMs = timestampMs(raw.timestamp);
    if (atMs === null || atMs > nowMs || raw.status !== 'ok' ||
        raw.is_pending_update === true || raw.result === 'error') {
      return { timestamp: atMs, activities: [] };
    }
    const from = isRecord(raw.from) && typeof raw.from.hash === 'string' ? raw.from.hash : null;
    const to = isRecord(raw.to) && typeof raw.to.hash === 'string' ? raw.to.hash : null;
    const role = roleFor('ETH', address, from, to);
    const amount = decimalAmount(raw.value, 18);
    return {
      timestamp: atMs,
      activities: amount && role !== 'PARTICIPANT'
        ? [makeActivity(
            address, 'ETH', raw.hash, 'native:0', atMs, role, 'NATIVE_TRANSFER',
            [from, to].filter((party): party is string => party !== null && party.toLowerCase() !== normalizedAddress),
            { amountNative: amount },
          )]
        : [makeActivity(address, 'ETH', raw.hash, 'history:contract', atMs, role, 'CONTRACT_INTERACTION', [])],
    };
  });
  const tokens = await fetchBlockscoutItems(tokenPath, fromMs, (raw) => {
    if (!isRecord(raw) || typeof raw.transaction_hash !== 'string') {
      return { timestamp: null, activities: [] };
    }
    const atMs = timestampMs(raw.timestamp);
    if (atMs === null || atMs > nowMs) return { timestamp: atMs, activities: [] };
    const from = typeof raw.from === 'string' ? raw.from : null;
    const to = typeof raw.to === 'string' ? raw.to : null;
    const role = roleFor('ETH', address, from, to);
    const token = isRecord(raw.token) ? raw.token : {};
    const total = isRecord(raw.total) ? raw.total : {};
    const tokenAddress = typeof token.address_hash === 'string'
      ? token.address_hash
      : typeof token.address === 'string' ? token.address : undefined;
    const symbol = typeof token.symbol === 'string' ? token.symbol : undefined;
    const amount = decimalAmount(total.value, token.decimals);
    const transferId = `token:${tokenAddress ?? 'unknown'}:${String(raw.log_index ?? 'item')}`;
    return {
      timestamp: atMs,
      activities: [makeActivity(
        address, 'ETH', raw.transaction_hash, transferId, atMs, role, 'TOKEN_TRANSFER',
        [from, to].filter((party): party is string => party !== null && party.toLowerCase() !== normalizedAddress),
        {
          ...(amount ? { tokenAmount: amount } : {}),
          ...(symbol ? { tokenSymbol: symbol } : {}),
          ...(tokenAddress ? { tokenAddress } : {}),
        },
      )],
    };
  });
  const tokenGroups = new Map<string, {
    incoming: Set<string>;
    outgoing: Set<string>;
    nativeIncoming: boolean;
    nativeOutgoing: boolean;
    time: number;
    counterparties: Set<string>;
  }>();
  for (const activity of tokens.activities) {
    if (!activity.tokenAddress) continue;
    const group = tokenGroups.get(activity.transactionHash) ?? {
      incoming: new Set<string>(), outgoing: new Set<string>(), time: activity.timestampMs,
      nativeIncoming: false, nativeOutgoing: false,
      counterparties: new Set<string>(),
    };
    (activity.role === 'INCOMING' ? group.incoming : activity.role === 'OUTGOING' ? group.outgoing : new Set())
      .add(activity.tokenAddress.toLowerCase());
    activity.counterpartyAddresses.forEach((party) => group.counterparties.add(party));
    tokenGroups.set(activity.transactionHash, group);
  }
  for (const activity of native.activities) {
    const group = tokenGroups.get(activity.transactionHash);
    if (!group || activity.activityType !== 'NATIVE_TRANSFER') continue;
    if (activity.role === 'INCOMING') group.nativeIncoming = true;
    if (activity.role === 'OUTGOING') group.nativeOutgoing = true;
  }
  const swapPatterns = [...tokenGroups.entries()].flatMap(([hash, group]) => {
    const tokenSwap = [...group.incoming].some((token) =>
      [...group.outgoing].some((other) => other !== token));
    const nativeTokenSwap = (group.incoming.size > 0 && group.nativeOutgoing) ||
      (group.outgoing.size > 0 && group.nativeIncoming);
    return tokenSwap || nativeTokenSwap
      ? [makeActivity(address, 'ETH', hash, 'history:swap-pattern', group.time, 'PARTICIPANT',
          'SWAP_PATTERN', [...group.counterparties])]
      : [];
  });
  const allComplete = native.complete && tokens.complete;
  return {
    activities: [...native.activities, ...tokens.activities, ...swapPatterns],
    status: allComplete ? 'COMPLETE' : 'PARTIAL',
    source: 'Blockscout (Ethereum)',
    coverageFromMs: fromMs,
    ...(!allComplete ? { error: 'At least one Blockscout history endpoint hit its pagination safety limit.' } : {}),
  };
}

function solanaAddressKeys(transaction: Record<string, unknown>): string[] {
  if (!isRecord(transaction.transaction) || !isRecord(transaction.transaction.message) ||
      !Array.isArray(transaction.transaction.message.accountKeys)) return [];
  return transaction.transaction.message.accountKeys.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    return isRecord(entry) && typeof entry.pubkey === 'string' ? [entry.pubkey] : [];
  });
}

function solanaSignerAddresses(transaction: Record<string, unknown>): string[] {
  if (!isRecord(transaction.transaction) || !isRecord(transaction.transaction.message) ||
      !Array.isArray(transaction.transaction.message.accountKeys)) return [];
  return transaction.transaction.message.accountKeys.flatMap((entry) =>
    isRecord(entry) && entry.signer === true && typeof entry.pubkey === 'string'
      ? [entry.pubkey]
      : []);
}

async function fetchSolanaHistory(
  address: string,
  fromMs: number,
  nowMs: number,
): Promise<WalletHistoryPage> {
  const tokenPrograms = [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ];
  const tokenAccountKeys = new Set<string>();
  let partial = false;
  for (const programId of tokenPrograms) {
    const result = await jsonRpc(SOLANA_RPC, 'getTokenAccountsByOwner', [
      address, { programId }, { encoding: 'jsonParsed', commitment: 'finalized' },
    ]);
    if (!isRecord(result) || !Array.isArray(result.value)) {
      throw new Error('Solana token-account response is malformed.');
    }
    for (const entry of result.value) {
      if (isRecord(entry) && typeof entry.pubkey === 'string') tokenAccountKeys.add(entry.pubkey);
    }
  }
  if (tokenAccountKeys.size > MAX_SOLANA_TOKEN_ACCOUNTS) partial = true;
  const trackedAccounts = [address, ...[...tokenAccountKeys].slice(0, MAX_SOLANA_TOKEN_ACCOUNTS)];
  const signatures = new Map<string, number>();
  let remaining = MAX_SOLANA_SIGNATURES;
  for (const account of trackedAccounts) {
    let before: string | undefined;
    for (let page = 0; page < 10 && remaining > 0; page += 1) {
      const pageSize = Math.min(100, remaining);
      const result = await jsonRpc(SOLANA_RPC, 'getSignaturesForAddress', [
        account, { limit: pageSize, ...(before ? { before } : {}), commitment: 'finalized' },
      ]);
      if (!Array.isArray(result)) throw new Error('Solana signature-history response is malformed.');
      if (result.length === 0) break;
      for (const entry of result) {
        if (!isRecord(entry) || typeof entry.signature !== 'string') continue;
        const time = Number(entry.blockTime) * 1_000;
        if (Number.isSafeInteger(time) && time > 0) {
          if (time < fromMs) continue;
          if (time <= nowMs) signatures.set(entry.signature, time);
        } else {
          partial = true;
        }
      }
      const last = result[result.length - 1];
      if (!isRecord(last) || typeof last.signature !== 'string' || last.signature === before) {
        throw new Error('Solana signature-history pagination cursor is invalid.');
      }
      before = last.signature;
      remaining -= result.length;
      const oldestTime = isRecord(last) ? Number(last.blockTime) * 1_000 : NaN;
      if (Number.isSafeInteger(oldestTime) && oldestTime < fromMs) break;
      if (result.length < pageSize) break;
      if (remaining === 0) partial = true;
    }
  }
  const signaturesToRead = [...signatures.entries()];
  const activities: WalletHistoryActivity[] = [];
  for (let offset = 0; offset < signaturesToRead.length; offset += 4) {
    const batch = signaturesToRead.slice(offset, offset + 4);
    const results = await Promise.all(batch.map(async ([signature, time]) => ({
      signature,
      time,
      transaction: await jsonRpc(SOLANA_RPC, 'getTransaction', [
        signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1 },
      ]),
    })));
    for (const { signature, time, transaction } of results) {
      if (!isRecord(transaction) || !isRecord(transaction.meta) ||
          transaction.meta.err !== null) {
        partial = true;
        continue;
      }
      const keys = solanaAddressKeys(transaction);
      const counterparties = solanaSignerAddresses(transaction)
        .filter((key) => key !== address)
        .slice(0, 20);
      const message = isRecord(transaction.transaction) &&
        isRecord(transaction.transaction.message) ? transaction.transaction.message : {};
      const instructions = Array.isArray(message.instructions) ? message.instructions : [];
      instructions.forEach((instruction, index) => {
        if (!isRecord(instruction) || instruction.program !== 'system' ||
            !isRecord(instruction.parsed) || instruction.parsed.type !== 'transfer' ||
            !isRecord(instruction.parsed.info)) return;
        const info = instruction.parsed.info;
        if (typeof info.source !== 'string' || typeof info.destination !== 'string') return;
        const lamports = positiveNumber(info.lamports);
        if (!lamports || (info.source !== address && info.destination !== address)) return;
        activities.push(makeActivity(
          address, 'SOL', signature, `instruction:${index}`, time,
          roleFor('SOL', address, info.source, info.destination), 'NATIVE_TRANSFER',
          [info.source, info.destination].filter((party) => party !== address),
          { amountNative: lamports / 1e9 },
        ));
      });
      const tokenDeltas = new Map<string, { amount: number; symbol: string; decimals: number }>();
      const tokenCounterparties = new Set<string>();
      const balanceRows = [
        ...(Array.isArray(transaction.meta.preTokenBalances) ? transaction.meta.preTokenBalances : [])
          .map((item) => ({ item, side: -1 as const })),
        ...(Array.isArray(transaction.meta.postTokenBalances) ? transaction.meta.postTokenBalances : [])
          .map((item) => ({ item, side: 1 as const })),
      ];
      for (const { item, side } of balanceRows) {
        if (!isRecord(item) || typeof item.mint !== 'string' ||
            !isRecord(item.uiTokenAmount)) continue;
        const accountAddress = Number.isSafeInteger(item.accountIndex)
          ? keys[Number(item.accountIndex)]
          : null;
        const tokenOwner = typeof item.owner === 'string' ? item.owner : null;
        if (tokenOwner !== address &&
            (accountAddress === null || !tokenAccountKeys.has(accountAddress))) {
          if (tokenOwner !== null && tokenOwner !== address) tokenCounterparties.add(tokenOwner);
          continue;
        }
        const amount = Number(item.uiTokenAmount.uiAmountString ?? item.uiTokenAmount.uiAmount);
        const decimals = Number(item.uiTokenAmount.decimals);
        if (!Number.isFinite(amount) || !Number.isSafeInteger(decimals) || decimals < 0) continue;
        const previous = tokenDeltas.get(item.mint) ?? { amount: 0, symbol: item.mint, decimals };
        previous.amount += amount * side;
        tokenDeltas.set(item.mint, previous);
      }
      const changedMints = [...tokenDeltas.entries()].filter(([, value]) => Math.abs(value.amount) > 0);
      for (const [mint, change] of changedMints) {
        activities.push(makeActivity(
          address, 'SOL', signature, `token:${mint}`, time,
          change.amount > 0 ? 'INCOMING' : 'OUTGOING', 'TOKEN_TRANSFER',
          [...new Set([...counterparties, ...tokenCounterparties])],
          { tokenAmount: Math.abs(change.amount), tokenAddress: mint, tokenSymbol: mint },
        ));
      }
      if (changedMints.length >= 2 &&
          changedMints.some(([, change]) => change.amount > 0) &&
          changedMints.some(([, change]) => change.amount < 0) ||
          changedMints.some(([, change]) => change.amount > 0) &&
            activities.some(({ transactionHash: hash, activityType, role }) =>
              hash === signature && activityType === 'NATIVE_TRANSFER' && role === 'OUTGOING') ||
          changedMints.some(([, change]) => change.amount < 0) &&
            activities.some(({ transactionHash: hash, activityType, role }) =>
              hash === signature && activityType === 'NATIVE_TRANSFER' && role === 'INCOMING')) {
        activities.push(makeActivity(
          address, 'SOL', signature, 'history:swap-pattern', time, 'PARTICIPANT',
          'SWAP_PATTERN', counterparties,
        ));
      }
      if (changedMints.length === 0 &&
          !activities.some(({ transactionHash: hash }) => hash === signature)) {
        activities.push(makeActivity(
          address, 'SOL', signature, 'history:transaction', time, 'PARTICIPANT',
          'CONTRACT_INTERACTION', counterparties,
        ));
      }
    }
  }
  return {
    activities,
    status: partial ? 'PARTIAL' : 'COMPLETE',
    source: 'Solana Foundation public RPC',
    coverageFromMs: fromMs,
    ...(partial ? { error: 'Solana RPC history was incomplete, pruned, or exceeded the per-wallet safety cap.' } : {}),
  };
}

function getXrpDeliveredAmount(meta: Record<string, unknown>): unknown {
  return meta.delivered_amount ?? meta.DeliveredAmount;
}

async function fetchXrpHistory(
  address: string,
  fromMs: number,
  nowMs: number,
): Promise<WalletHistoryPage> {
  const activities: WalletHistoryActivity[] = [];
  let marker: unknown = undefined;
  let reachedWindowStart = false;
  let exhausted = false;
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const rawPayload = await postJson(XRP_RPC, {
          method: 'account_tx',
          params: [{
            account: address,
            ledger_index_min: -1,
            ledger_index_max: -1,
            binary: false,
            forward: false,
            limit: 200,
            ...(marker !== undefined ? { marker } : {}),
          }],
        });
    if (!isRecord(rawPayload) || !isRecord(rawPayload.result) ||
        !Array.isArray(rawPayload.result.transactions)) {
      throw new Error('XRPL account_tx history response is malformed.');
    }
    const result = rawPayload.result;
    const transactions = result.transactions;
    if (!Array.isArray(transactions)) throw new Error('XRPL account_tx history response is malformed.');
    for (const entry of transactions) {
      if (!isRecord(entry) || !isRecord(entry.tx) || !isRecord(entry.meta) ||
          entry.validated !== true || entry.meta.TransactionResult !== 'tesSUCCESS') continue;
      const tx = entry.tx;
      const dateSeconds = Number(tx.date);
      const atMs = (dateSeconds + XRP_EPOCH_SECONDS) * 1_000;
      if (!Number.isSafeInteger(dateSeconds) || dateSeconds < 0 || atMs > nowMs) continue;
      if (atMs < fromMs) {
        reachedWindowStart = true;
        continue;
      }
      const hash = typeof tx.hash === 'string' ? tx.hash : null;
      if (!hash) continue;
      const account = typeof tx.Account === 'string' ? tx.Account : null;
      const destination = typeof tx.Destination === 'string' ? tx.Destination : null;
      const role = roleFor('XRP', address, account, destination);
      if (tx.TransactionType === 'Payment') {
        const delivered = getXrpDeliveredAmount(entry.meta);
        if (typeof delivered === 'string') {
          const amount = decimalAmount(delivered, 6);
          if (amount) {
            activities.push(makeActivity(
              address, 'XRP', hash, 'payment:0', atMs, role, 'NATIVE_TRANSFER',
              [account, destination].filter((party): party is string => party !== null && party !== address),
              { amountNative: amount },
            ));
          }
        } else if (isRecord(delivered) && typeof delivered.value === 'string') {
          const amount = positiveNumber(delivered.value);
          const currency = typeof delivered.currency === 'string' ? delivered.currency : 'issued-token';
          const issuer = typeof delivered.issuer === 'string' ? delivered.issuer : 'unknown';
          activities.push(makeActivity(
            address, 'XRP', hash, `issued:${currency}:${issuer}`, atMs, role, 'TOKEN_TRANSFER',
            [account, destination].filter((party): party is string => party !== null && party !== address),
            {
              ...(amount ? { tokenAmount: amount } : {}),
              tokenSymbol: currency,
              tokenAddress: issuer,
            },
          ));
        }
        if (Array.isArray(tx.Paths) && tx.Paths.length > 0) {
          activities.push(makeActivity(
            address, 'XRP', hash, 'history:swap-pattern', atMs, 'PARTICIPANT',
            'SWAP_PATTERN', [account, destination]
              .filter((party): party is string => party !== null && party !== address),
          ));
        }
      } else if (tx.TransactionType === 'OfferCreate' ||
          ['AMMDeposit', 'AMMWithdraw', 'AMMCreate'].includes(String(tx.TransactionType))) {
        activities.push(makeActivity(
          address, 'XRP', hash, 'history:dex-order', atMs, 'PARTICIPANT',
          'DEX_ORDER', [],
        ));
      } else {
        activities.push(makeActivity(
          address, 'XRP', hash, 'history:transaction', atMs, role,
          'CONTRACT_INTERACTION', [],
        ));
      }
    }
    if (reachedWindowStart) break;
    marker = result.marker;
    if (marker === undefined) {
      exhausted = true;
      break;
    }
  }
  const complete = reachedWindowStart || exhausted;
  return {
    activities,
    status: complete ? 'COMPLETE' : 'PARTIAL',
    source: 'XRPL Cluster public API',
    coverageFromMs: fromMs,
    ...(!complete ? { error: `XRPL account history reached the ${MAX_HISTORY_PAGES}-page safety limit.` } : {}),
  };
}

export async function fetchPublicWalletHistory(options: {
  address: string;
  chain: QuorumAsset;
  fromMs?: number;
  nowMs?: number;
}): Promise<{ activities: WalletHistoryActivity[]; syncResult: WalletHistorySyncResult }> {
  const nowMs = options.nowMs ?? Date.now();
  const fromMs = options.fromMs ?? nowMs - HISTORY_WINDOW_MS;
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(fromMs) ||
      fromMs <= 0 || fromMs > nowMs || options.address.trim().length === 0) {
    throw new Error('Public wallet-history query is invalid.');
  }
  if (options.chain === 'BNB') {
    return {
      activities: [],
      syncResult: {
        address: options.address,
        chain: options.chain,
        status: 'UNAVAILABLE',
        source: null,
        coverageFromMs: null,
        error: 'No free, no-registration BNB address-history indexer was verified; public BNB JSON-RPC only serves block/transaction lookups.',
      },
    };
  }
  let page: WalletHistoryPage;
  try {
    switch (options.chain) {
      case 'BTC':
        page = await fetchBitcoinHistory(options.address, fromMs, nowMs);
        break;
      case 'ETH':
        page = await fetchEthereumHistory(options.address, fromMs, nowMs);
        break;
      case 'SOL':
        page = await fetchSolanaHistory(options.address, fromMs, nowMs);
        break;
      case 'XRP':
        page = await fetchXrpHistory(options.address, fromMs, nowMs);
        break;
    }
    return {
      activities: page.activities,
      syncResult: {
        address: options.address,
        chain: options.chain,
        status: page.status,
        source: page.source,
        coverageFromMs: page.coverageFromMs,
        error: page.error ?? null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      activities: [],
      syncResult: {
        address: options.address,
        chain: options.chain,
        status: 'UNAVAILABLE',
        source: options.chain === 'ETH'
          ? 'Blockscout (Ethereum)'
          : options.chain === 'BTC'
            ? 'mempool.space'
            : options.chain === 'SOL'
              ? 'Solana Foundation public RPC'
              : 'XRPL Cluster public API',
        coverageFromMs: null,
        error: message,
      },
    };
  }
}

export async function syncPublicWalletHistories(options: {
  nowMs?: number;
  maxProfiles?: number;
} = {}): Promise<{
  scannedProfiles: number;
  newActivities: number;
  results: WalletHistorySyncResult[];
}> {
  const nowMs = options.nowMs ?? Date.now();
  const dueProfiles = await readWalletProfilesDueForHistory({
    nowMs,
    limit: options.maxProfiles ?? 3,
  });
  const activities: WalletHistoryActivity[] = [];
  const results: WalletHistorySyncResult[] = [];
  for (const profile of dueProfiles) {
    const lastSyncedMs = profile.history_synced_at === null
      ? null
      : Date.parse(profile.history_synced_at);
    const fromMs = profile.history_sync_status === 'COMPLETE' && lastSyncedMs !== null
      ? Math.max(nowMs - HISTORY_WINDOW_MS, lastSyncedMs - 60 * 60_000)
      : nowMs - HISTORY_WINDOW_MS;
    const history = await fetchPublicWalletHistory({
      address: profile.address,
      chain: profile.chain,
      fromMs,
      nowMs,
    });
    activities.push(...history.activities);
    results.push(history.syncResult);
    if (history.syncResult.status !== 'COMPLETE') {
      console.warn(
        `[WalletHistory] ${profile.chain}:${profile.address} history ${history.syncResult.status}: ${history.syncResult.error ?? 'coverage is partial.'}`,
      );
    }
  }
  if (results.length > 0) {
    const ingestion = await ingestWalletHistory({ activities, syncResults: results, nowMs });
    console.info(
      `[WalletHistory] Synced ${results.length} discovered profiles; ${ingestion.newEvents} new activities.`,
    );
  }
  return { scannedProfiles: results.length, newActivities: activities.length, results };
}
