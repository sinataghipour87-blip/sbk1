import assert from 'node:assert/strict';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
import { fetchBscOnChainData, resetBscOnChainCacheForTests } from '../src/services/bscOnChain';
import { fetchPublicEvmOnChainData, resetPublicEvmOnChainCacheForTests } from '../src/services/publicEvmOnChain';
import { fetchSolanaOnChainData, resetSolanaOnChainCacheForTests } from '../src/services/solanaOnChain';
import { fetchXrpOnChainData, resetXrpOnChainCacheForTests } from '../src/services/xrpOnChain';

const envNames = [
  'HELIUS_API_KEY',
  'ETHERSCAN_API_KEY',
  'SBK1_ETHERSCAN_WATCH_ADDRESSES',
  'SBK1_SOL_WATCH_ADDRESSES',
  'SBK1_XRP_WATCH_ADDRESSES',
  'SBK1_BNB_WATCH_ADDRESSES',
  'SBK1_WHALE_MIN_SOL',
  'SBK1_WHALE_MIN_ETH',
  'SBK1_WHALE_MIN_XRP',
  'SBK1_WHALE_MIN_BNB',
] as const;
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const nowMs = Date.now();

function setEnv(name: typeof envNames[number], value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
  for (const name of envNames) setEnv(name, undefined);
  for (const reset of [
    resetSolanaOnChainCacheForTests,
    resetXrpOnChainCacheForTests,
    resetBscOnChainCacheForTests,
  ]) reset();

  for (const [pair, provider] of [
    ['SOL/USDT:USDT', fetchSolanaOnChainData],
    ['XRP/USDT:USDT', fetchXrpOnChainData],
    ['BNB/USDT:USDT', fetchBscOnChainData],
  ] as const) {
    let requested = false;
    const unavailable = await provider({
      pair,
      nowMs,
      fetcher: async () => {
        requested = true;
        throw new Error('unconfigured provider should not make a request');
      },
    });
    assert.equal(unavailable.status, 'UNAVAILABLE');
    assert.equal(unavailable.pair, pair);
    assert.equal(unavailable.asset, pair.slice(0, 3));
    assert.match(unavailable.unavailableReason ?? '', /two .* (provider|operator)/i);
    assert.equal(requested, true, 'public transactions are scanned even without exchange labels');
    assert.equal(evaluateEightMemberCouncil({
      pair,
      whaleFlowData: unavailable,
      nowMs,
    }).members[5].vote, 'ABSTAIN');
  }

  const solWallet = 'A'.repeat(32);
  const solSignature = '5'.repeat(88);
  setEnv('SBK1_SOL_WATCH_ADDRESSES', JSON.stringify({ [solWallet]: 'Verified exchange' }));
  setEnv('SBK1_WHALE_MIN_SOL', '10');
  resetSolanaOnChainCacheForTests();
  const publicSolMethods: string[] = [];
  const publicSolana = await fetchSolanaOnChainData({
    pair: 'SOL/USDT:USDT',
    priceUsd: 150,
    nowMs,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      publicSolMethods.push(body.method);
      switch (body.method) {
        case 'getSlot':
          return Response.json({ jsonrpc: '2.0', id: 1, result: 500 });
        case 'getBlockTime':
          return Response.json({ jsonrpc: '2.0', id: 1, result: Math.floor(nowMs / 1_000) - 30 });
        case 'getSignaturesForAddress':
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: [{
              signature: solSignature,
              slot: 499,
              blockTime: Math.floor(nowMs / 1_000) - 30,
              err: null,
              confirmationStatus: 'finalized',
            }],
          });
        case 'getTransaction':
          return Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: {
              transaction: {
                message: {
                  instructions: [{
                    program: 'system',
                    parsed: {
                      type: 'transfer',
                      info: { destination: solWallet, lamports: '11000000000' },
                    },
                  }],
                },
              },
              meta: { err: null, innerInstructions: [] },
            },
          });
        default:
          throw new Error(`Unexpected public Solana RPC method ${body.method}.`);
      }
    },
  });
  assert.deepEqual(
    Object.fromEntries([...new Set(publicSolMethods)].map((method) => [
      method,
      publicSolMethods.filter((candidate) => candidate === method).length,
    ])),
    {
      getSlot: 2,
      getBlockTime: 2,
      getSignaturesForAddress: 2,
      getTransaction: 2,
    },
  );
  assert.equal(publicSolana.status, 'LIVE');
  assert.equal(publicSolana.sourceId, 'onchain.solana-public-rpc');
  assert.match(publicSolana.provider, /independent public Solana RPC/);
  assert.equal(publicSolana.independentProviderCount, 2);
  assert.equal(publicSolana.largeTransfers?.length, 1);
  assert.equal(publicSolana.largeTransfers?.[0].amount, 11);
  assert.equal(publicSolana.largeTransfers?.[0].asset, 'SOL');

  setEnv('SBK1_SOL_WATCH_ADDRESSES', undefined);
  setEnv('SBK1_WHALE_MIN_SOL', '1');
  resetSolanaOnChainCacheForTests();
  const publicSolBlockScan = await fetchSolanaOnChainData({
    pair: 'SOL/USDT:USDT',
    nowMs: nowMs + 1_000,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (body.method === 'getSlot') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: 500 });
      }
      if (body.method === 'getBlocks') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: [498, 499, 500] });
      }
      assert.equal(body.method, 'getBlock');
      const [slot, config] = body.params as [number, { maxSupportedTransactionVersion: number }];
      assert.equal(config.maxSupportedTransactionVersion, 1);
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          blockTime: Math.floor(nowMs / 1_000) - 30,
          transactions: slot === 500 ? [{
            transaction: {
              signatures: [solSignature],
              message: {
                instructions: [{
                  program: 'system',
                  parsed: {
                    type: 'transfer',
                    info: { lamports: '10000000000' },
                  },
                }],
              },
            },
            meta: { err: null },
          }] : [],
        },
      });
    },
  });
  assert.equal(publicSolBlockScan.status, 'LIVE');
  assert.equal(publicSolBlockScan.independentProviderCount, 2);
  assert.equal(publicSolBlockScan.largeTransfers?.length, 1);
  assert.equal(publicSolBlockScan.largeTransfers?.[0].amount, 10);
  assert.match(publicSolBlockScan.largeTransfers?.[0].sourceProvider ?? '', /wallet ownership unknown/);

  const xrpWallet = `r${'1'.repeat(25)}`;
  const xrpHash = 'a'.repeat(64);
  setEnv('SBK1_XRP_WATCH_ADDRESSES', JSON.stringify({ [xrpWallet]: 'Verified exchange' }));
  setEnv('SBK1_WHALE_MIN_XRP', '1');
  resetXrpOnChainCacheForTests();
  let xrpCalls = 0;
  let xrpDrops = '2500000000';
  const xrpFetcher: typeof fetch = async (input, init) => {
    xrpCalls += 1;
    const url = new URL(String(input));
    if (url.hostname === 'api.xrpscan.com') {
      assert.ok(url.pathname.endsWith(`/account/${xrpWallet}/transactions`));
      assert.equal(url.searchParams.get('limit'), '200');
      return Response.json({
        account: xrpWallet,
        transactions: [{
          TransactionType: 'Payment',
          Destination: xrpWallet,
          validated: true,
          hash: xrpHash,
          ledger_index: 90_000_000,
          date: new Date(nowMs - 1_000).toISOString(),
          Amount: xrpDrops,
          meta: { TransactionResult: 'tesSUCCESS', TransactionIndex: 2 },
        }],
      });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      method?: string;
      params?: Array<Record<string, unknown>>;
    };
    if (body.method === 'account_tx') {
      assert.equal(body.params?.[0].ledger_index_min, 89_999_991);
      assert.equal(body.params?.[0].ledger_index_max, 90_000_000);
    }
    return Response.json({
      status: 'success',
      result: body.method === 'server_info'
        ? { info: { validated_ledger: { seq: 90_000_000, age: 1 } } }
        : {
          transactions: [{
            validated: true,
            ledger_index: 90_000_000,
            tx: {
              TransactionType: 'Payment',
              Destination: xrpWallet,
              hash: xrpHash,
              date: Math.floor((nowMs - 1_000 - 946_684_800_000) / 1_000),
              Amount: xrpDrops,
            },
            meta: {
              TransactionResult: 'tesSUCCESS',
              TransactionIndex: 2,
              delivered_amount: xrpDrops,
            },
          }],
        },
    });
  };
  const xrp = await fetchXrpOnChainData({
    pair: 'XRP/USDT:USDT',
    priceUsd: 0.5,
    nowMs,
    fetcher: xrpFetcher,
  });
  assert.equal(xrpCalls, 11,
    'all XRPL RPC endpoints are queried in parallel, while same-operator endpoints remain one quorum member');
  assert.equal(xrp.status, 'LIVE');
  assert.equal(xrp.sourceId, 'onchain.xrpscan-xrp');
  assert.equal(xrp.independentProviderCount, 3);
  assert.equal(xrp.largeTransfers?.length, 1);
  assert.equal(xrp.largeTransfers?.[0].asset, 'XRP');
  assert.equal(xrp.largeTransfers?.[0].blockchain, 'xrp');
  assert.equal(xrp.largeTransfers?.[0].amount, 2_500);
  assert.equal(xrp.largeTransfers?.[0].estimatedUsd, 1_250);
  assert.equal(xrp.largeTransfers?.[0].confirmationStatus, 'CONFIRMED');
  assert.equal(xrp.providerParticipation?.length, 6,
    'XRP sweep reports every endpoint while quorum still deduplicates same-operator nodes');
  assert.ok(xrp.providerParticipation?.every(({ status }) => status === 'VALID'));
  resetXrpOnChainCacheForTests();
  let usedRippleBackup = false;
  const xrpWithRpcFailover = await fetchXrpOnChainData({
    pair: 'XRP/USDT:USDT',
    priceUsd: 0.5,
    nowMs: nowMs + 500,
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 's1.ripple.com') {
        return new Response('temporarily unavailable', { status: 503 });
      }
      if (url.hostname === 's2.ripple.com') usedRippleBackup = true;
      const response = await xrpFetcher(input, init);
      if (url.hostname === 'api.xrpscan.com') return response;
      const payload = await response.json() as { result?: unknown };
      return Response.json({ result: payload.result });
    },
  });
  assert.equal(usedRippleBackup, true,
    'the second endpoint for the same XRPL operator is used after a primary failure');
  assert.equal(xrpWithRpcFailover.status, 'LIVE');
  assert.equal(xrpWithRpcFailover.independentProviderCount, 3,
    'same-operator endpoint failover does not inflate independent-provider quorum');
  assert.equal(
    xrpWithRpcFailover.providerParticipation?.find(({ provider }) =>
      provider === 'Ripple s1 validated RPC'
    )?.status,
    'THROTTLED',
    'parallel XRP sweep reports throttled endpoint participation explicitly',
  );
  xrpDrops = '999000000';
  xrpCalls = 0;
  resetXrpOnChainCacheForTests();
  const xrpBelowFloor = await fetchXrpOnChainData({
    pair: 'XRP/USDT:USDT',
    priceUsd: 0.5,
    nowMs: nowMs + 1_000,
    fetcher: xrpFetcher,
  });
  assert.equal(xrpCalls, 11);
  assert.equal(xrpBelowFloor.status, 'LIVE');
  assert.deepEqual(xrpBelowFloor.largeTransfers, [], 'a low override cannot lower the XRP floor below 1,000');

  setEnv('SBK1_XRP_WATCH_ADDRESSES', undefined);
  resetXrpOnChainCacheForTests();
  const recentLedgerIndices: number[] = [];
  const xrpRecentLedgerScan = await fetchXrpOnChainData({
    pair: 'XRP/USDT:USDT',
    nowMs: nowMs + 2_000,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        method: string;
        params: Array<Record<string, unknown>>;
      };
      if (body.method === 'server_info') {
        return Response.json({
          status: 'success',
          result: { info: { validated_ledger: { seq: 90_000_000, age: 1 } } },
        });
      }
      assert.equal(body.method, 'ledger');
      const ledgerIndex = body.params[0].ledger_index;
      assert.equal(typeof ledgerIndex, 'number');
      recentLedgerIndices.push(ledgerIndex as number);
      return Response.json({
        status: 'success',
        result: {
          ledger: {
            transactions: [],
            close_time_iso: new Date(nowMs + 1_000).toISOString(),
          },
        },
      });
    },
  });
  assert.equal(xrpRecentLedgerScan.status, 'LIVE');
  assert.equal(xrpRecentLedgerScan.independentProviderCount, 2);
  assert.equal(recentLedgerIndices.length, 50,
    'all five RPC endpoints scan at most ten recent ledgers while still counting only two independent operators');
  assert.equal(Math.min(...recentLedgerIndices), 89_999_991);
  assert.equal(Math.max(...recentLedgerIndices), 90_000_000);

  const bscWallet = `0x${'a'.repeat(40)}`;
  const bscHash = `0x${'b'.repeat(64)}`;
  setEnv('SBK1_BNB_WATCH_ADDRESSES', JSON.stringify({ [bscWallet]: 'Verified exchange' }));
  setEnv('SBK1_WHALE_MIN_BNB', '5');
  resetBscOnChainCacheForTests();
  setEnv('SBK1_WHALE_MIN_BNB', '1');
  const publicBscWallet = bscWallet;
  let publicBscMethods = 0;
  const bscProviders = new Set<string>();
  const publicBsc = await fetchBscOnChainData({
    pair: 'BNB/USDT:USDT',
    priceUsd: 600,
    nowMs,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      const endpoint = String(_input);
      bscProviders.add(new URL(endpoint).hostname);
      publicBscMethods += 1;
      if (body.method === 'eth_chainId') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: '0x38' });
      }
      if (body.method === 'eth_blockNumber') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: '0x64' });
      }
      assert.equal(body.method, 'eth_getBlockByNumber');
      const height = Number.parseInt(String(body.params[0]), 16);
      const transactions = height === 89 ? [{
        hash: bscHash,
        to: publicBscWallet,
        value: `0x${(4n * 10n ** 18n).toString(16)}`,
        blockNumber: '0x59',
      }] : [];
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: `0x${height.toString(16)}`,
          timestamp: `0x${Math.floor(nowMs / 1_000 - (100 - height) * 3).toString(16)}`,
          transactions,
        },
      });
    },
  });
  assert.equal(publicBscMethods, 208);
  assert.equal(publicBsc.status, 'LIVE');
  assert.equal(publicBsc.sourceId, 'onchain.bsc-publicnode');
  assert.equal(bscProviders.size, 4);
  assert.equal(publicBsc.independentProviderCount, 4,
    'the two Binance DataSeed URLs are one RPC operator for independent quorum');
  assert.match(publicBsc.provider, /chainid=56/);
  assert.deepEqual(publicBsc.largeTransfers, [], 'a low override cannot lower the BNB floor below 5');

  resetPublicEvmOnChainCacheForTests();
  const wrongChain = await fetchPublicEvmOnChainData({
    pair: 'ETH/USDT:USDT',
    asset: 'ETH',
    blockchain: 'ethereum',
    chainId: 1,
    providers: [{ name: 'wrong-chain mock', endpoint: 'https://rpc.example.invalid/' }],
    addresses: [`0x${'c'.repeat(40)}`],
    threshold: 100,
    nowMs,
    fetcher: async () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x38' }),
  });
  assert.equal(wrongChain.status, 'UNAVAILABLE');
  assert.match(wrongChain.unavailableReason ?? '', /two independent public RPC providers/);

  resetPublicEvmOnChainCacheForTests();
  const ethHash = `0x${'d'.repeat(64)}`;
  const ethBelowFloor = await fetchPublicEvmOnChainData({
    pair: 'ETH/USDT:USDT',
    asset: 'ETH',
    blockchain: 'ethereum',
    chainId: 1,
    providers: [
      { name: 'Ethereum provider A', operator: 'A', endpoint: 'https://a.example.invalid/' },
      { name: 'Ethereum provider B', operator: 'B', endpoint: 'https://b.example.invalid/' },
    ],
    addresses: [],
    threshold: 1,
    nowMs,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (body.method === 'eth_chainId') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' });
      }
      if (body.method === 'eth_blockNumber') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: '0x64' });
      }
      assert.equal(body.method, 'eth_getBlockByNumber');
      const height = Number.parseInt(String(body.params[0]), 16);
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: `0x${height.toString(16)}`,
          timestamp: `0x${Math.floor(nowMs / 1_000 - 30).toString(16)}`,
          transactions: height === 89 ? [{
            hash: ethHash,
            to: `0x${'e'.repeat(40)}`,
            value: `0x${(99n * 10n ** 18n).toString(16)}`,
            blockNumber: '0x59',
          }] : [],
        },
      });
    },
  });
  assert.equal(ethBelowFloor.status, 'LIVE');
  assert.deepEqual(ethBelowFloor.largeTransfers, [], 'a low override cannot lower the ETH floor below 100');

  resetPublicEvmOnChainCacheForTests();
  const staleEvm = await fetchPublicEvmOnChainData({
    pair: 'ETH/USDT:USDT',
    asset: 'ETH',
    blockchain: 'ethereum',
    chainId: 1,
    providers: [
      { name: 'Ethereum stale provider A', operator: 'stale-A', endpoint: 'https://stale-a.example.invalid/' },
      { name: 'Ethereum stale provider B', operator: 'stale-B', endpoint: 'https://stale-b.example.invalid/' },
    ],
    addresses: [`0x${'e'.repeat(40)}`],
    threshold: 100,
    nowMs,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      if (body.method === 'eth_chainId') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' });
      }
      if (body.method === 'eth_blockNumber') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: '0x64' });
      }
      assert.equal(body.method, 'eth_getBlockByNumber');
      const height = Number.parseInt(String(body.params[0]), 16);
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          number: `0x${height.toString(16)}`,
          timestamp: `0x${Math.floor((Date.now() - 5 * 60_000) / 1_000).toString(16)}`,
          transactions: height === 99 ? [{
            hash: ethHash,
            to: `0x${'e'.repeat(40)}`,
            value: `0x${(1_000n * 10n ** 18n).toString(16)}`,
            blockNumber: '0x63',
          }] : [],
        },
      });
    },
  });
  assert.equal(staleEvm.status, 'UNAVAILABLE', 'EVM volume is excluded at the five-minute freshness boundary');
  assert.deepEqual(staleEvm.largeTransfers, []);

  resetSolanaOnChainCacheForTests();
  setEnv('SBK1_WHALE_MIN_SOL', '1');
  setEnv('SBK1_SOL_WATCH_ADDRESSES', JSON.stringify({ [solWallet]: 'Verified exchange' }));
  const underThreshold = await fetchSolanaOnChainData({
    pair: 'SOL/USDT:USDT',
    nowMs: nowMs + 20_000,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getSlot') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: 501 });
      }
      if (body.method === 'getBlockTime') {
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          result: Math.floor((nowMs + 20_000) / 1_000) - 30,
        });
      }
      if (body.method === 'getSignaturesForAddress') {
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          result: [{
            signature: solSignature,
            slot: 500,
            blockTime: Math.floor((nowMs + 20_000) / 1_000) - 30,
            err: null,
            confirmationStatus: 'finalized',
          }],
        });
      }
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          transaction: {
            message: {
              instructions: [{
                program: 'system',
                parsed: {
                  type: 'transfer',
                  info: { destination: solWallet, lamports: '9000000000' },
                },
              }],
            },
          },
          meta: { err: null, innerInstructions: [] },
        },
      });
    },
  });
  assert.equal(underThreshold.status, 'LIVE');
  assert.deepEqual(underThreshold.largeTransfers, []);

  console.log('SOL/XRP/BNB on-chain providers, keyless Solana/BSC fallbacks, network isolation, threshold and abstention checks passed.');
} finally {
  for (const name of envNames) setEnv(name, originalEnv[name]);
  resetSolanaOnChainCacheForTests();
  resetXrpOnChainCacheForTests();
  resetBscOnChainCacheForTests();
}
