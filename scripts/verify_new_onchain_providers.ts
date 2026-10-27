import assert from 'node:assert/strict';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
import { fetchBscOnChainData, resetBscOnChainCacheForTests } from '../src/services/bscOnChain';
import { fetchPublicEvmOnChainData, resetPublicEvmOnChainCacheForTests } from '../src/services/publicEvmOnChain';
import { fetchSolanaOnChainData, resetSolanaOnChainCacheForTests } from '../src/services/solanaOnChain';
import { fetchXrpOnChainData, resetXrpOnChainCacheForTests } from '../src/services/xrpOnChain';

const envNames = [
  'HELIUS_API_KEY',
  'XRPSCAN_API_KEY',
  'BSCSCAN_API_KEY',
  'ETHERSCAN_API_KEY',
  'SBK1_ETHERSCAN_WATCH_ADDRESSES',
  'SBK1_SOL_WATCH_ADDRESSES',
  'SBK1_XRP_WATCH_ADDRESSES',
  'SBK1_BNB_WATCH_ADDRESSES',
  'SBK1_WHALE_MIN_SOL',
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
    assert.match(unavailable.unavailableReason ?? '', /watchlist is not configured/i);
    assert.equal(requested, false);
    assert.equal(evaluateEightMemberCouncil({
      pair,
      whaleFlowData: unavailable,
      nowMs,
    }).members[5].vote, 'ABSTAIN');
  }

  const solWallet = 'A'.repeat(32);
  const solSignature = '5'.repeat(88);
  setEnv('HELIUS_API_KEY', 'test-helius-key');
  setEnv('SBK1_SOL_WATCH_ADDRESSES', JSON.stringify({ [solWallet]: 'Verified exchange' }));
  setEnv('SBK1_WHALE_MIN_SOL', '10');
  resetSolanaOnChainCacheForTests();
  const solMethods: string[] = [];
  const solana = await fetchSolanaOnChainData({
    pair: 'SOL/USDT:USDT',
    priceUsd: 150,
    nowMs,
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('api-key'), 'test-helius-key');
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      solMethods.push(body.method);
      if (body.method === 'getTransactionsForAddress') {
        assert.equal(body.params[0], solWallet);
        return Response.json({
          jsonrpc: '2.0',
          result: [{
            signature: solSignature,
            slot: 300,
            timestamp: Math.floor(nowMs / 1_000),
            nativeTransfers: [
              { fromUserAccount: 'B'.repeat(32), toUserAccount: solWallet, amount: 11_000_000_000 },
              { fromUserAccount: 'B'.repeat(32), toUserAccount: 'C'.repeat(32), amount: 99_000_000_000 },
            ],
          }],
        });
      }
      assert.equal(body.method, 'getSignatureStatuses');
      assert.deepEqual(body.params[0], [solSignature]);
      return Response.json({
        jsonrpc: '2.0',
        result: { value: [{ confirmationStatus: 'finalized', err: null }] },
      });
    },
  });
  assert.deepEqual(solMethods, ['getTransactionsForAddress', 'getSignatureStatuses']);
  assert.equal(solana.status, 'LIVE');
  assert.equal(solana.sourceId, 'onchain.helius-solana');
  assert.equal(solana.largeTransfers?.length, 1);
  assert.equal(solana.largeTransfers?.[0].asset, 'SOL');
  assert.equal(solana.largeTransfers?.[0].blockchain, 'solana');
  assert.equal(solana.largeTransfers?.[0].amount, 11);
  assert.equal(solana.largeTransfers?.[0].estimatedUsd, 1_650);
  assert.equal(solana.largeTransfers?.[0].confirmationStatus, 'CONFIRMED');

  setEnv('HELIUS_API_KEY', undefined);
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
  assert.deepEqual(publicSolMethods, [
    'getSlot',
    'getBlockTime',
    'getSignaturesForAddress',
    'getTransaction',
  ]);
  assert.equal(publicSolana.status, 'LIVE');
  assert.equal(publicSolana.sourceId, 'onchain.solana-public-rpc');
  assert.match(publicSolana.provider, /keyless standard Solana JSON-RPC/);
  assert.equal(publicSolana.largeTransfers?.length, 1);
  assert.equal(publicSolana.largeTransfers?.[0].amount, 11);
  assert.equal(publicSolana.largeTransfers?.[0].asset, 'SOL');

  const xrpWallet = `r${'1'.repeat(25)}`;
  const xrpHash = 'a'.repeat(64);
  setEnv('SBK1_XRP_WATCH_ADDRESSES', JSON.stringify({ [xrpWallet]: 'Verified exchange' }));
  setEnv('SBK1_WHALE_MIN_XRP', '1000');
  resetXrpOnChainCacheForTests();
  let xrpCalls = 0;
  const xrp = await fetchXrpOnChainData({
    pair: 'XRP/USDT:USDT',
    priceUsd: 0.5,
    nowMs,
    fetcher: async (input) => {
      xrpCalls += 1;
      const url = new URL(String(input));
      assert.equal(url.hostname, 'api.xrpscan.com');
      assert.ok(url.pathname.endsWith(`/account/${xrpWallet}/transactions`));
      return Response.json({
        account: xrpWallet,
        transactions: [{
          TransactionType: 'Payment',
          Destination: xrpWallet,
          validated: true,
          hash: xrpHash,
          ledger_index: 90_000_000,
          date: new Date(nowMs - 1_000).toISOString(),
          Amount: '2500000000',
          meta: { TransactionResult: 'tesSUCCESS', TransactionIndex: 2 },
        }],
      });
    },
  });
  assert.equal(xrpCalls, 1);
  assert.equal(xrp.status, 'LIVE');
  assert.equal(xrp.sourceId, 'onchain.xrpscan-xrp');
  assert.equal(xrp.largeTransfers?.length, 1);
  assert.equal(xrp.largeTransfers?.[0].asset, 'XRP');
  assert.equal(xrp.largeTransfers?.[0].blockchain, 'xrp');
  assert.equal(xrp.largeTransfers?.[0].amount, 2_500);
  assert.equal(xrp.largeTransfers?.[0].estimatedUsd, 1_250);
  assert.equal(xrp.largeTransfers?.[0].confirmationStatus, 'CONFIRMED');

  const bscWallet = `0x${'a'.repeat(40)}`;
  const bscHash = `0x${'b'.repeat(64)}`;
  setEnv('BSCSCAN_API_KEY', 'test-bscscan-key');
  setEnv('SBK1_BNB_WATCH_ADDRESSES', JSON.stringify({ [bscWallet]: 'Verified exchange' }));
  setEnv('SBK1_WHALE_MIN_BNB', '5');
  resetBscOnChainCacheForTests();
  let bscCalls = 0;
  const bsc = await fetchBscOnChainData({
    pair: 'BNB/USDT:USDT',
    priceUsd: 600,
    nowMs,
    fetcher: async (input) => {
      bscCalls += 1;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('chainid'), '56');
      assert.equal(url.searchParams.get('apikey'), 'test-bscscan-key');
      assert.equal(url.searchParams.get('address'), bscWallet);
      return Response.json({
        status: '1',
        message: 'OK',
        result: [{
          hash: bscHash,
          timeStamp: String(Math.floor((nowMs - 1_000) / 1_000)),
          blockNumber: '70000000',
          confirmations: '20',
          value: String(6n * 10n ** 18n),
          to: bscWallet,
          isError: '0',
        }],
      });
    },
  });
  assert.equal(bscCalls, 1);
  assert.equal(bsc.status, 'LIVE');
  assert.equal(bsc.sourceId, 'onchain.bscscan-bnb');
  assert.equal(bsc.largeTransfers?.length, 1);
  assert.equal(bsc.largeTransfers?.[0].asset, 'BNB');
  assert.equal(bsc.largeTransfers?.[0].blockchain, 'binance_smart_chain');
  assert.equal(bsc.largeTransfers?.[0].amount, 6);
  assert.equal(bsc.largeTransfers?.[0].estimatedUsd, 3_600);
  assert.equal(bsc.largeTransfers?.[0].confirmationStatus, 'CONFIRMED');

  setEnv('BSCSCAN_API_KEY', undefined);
  resetBscOnChainCacheForTests();
  const publicBscWallet = bscWallet;
  let publicBscMethods = 0;
  const publicBsc = await fetchBscOnChainData({
    pair: 'BNB/USDT:USDT',
    priceUsd: 600,
    nowMs,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
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
        value: `0x${(6n * 10n ** 18n).toString(16)}`,
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
  assert.equal(publicBscMethods, 52);
  assert.equal(publicBsc.status, 'LIVE');
  assert.equal(publicBsc.sourceId, 'onchain.bsc-public-rpc');
  assert.match(publicBsc.provider, /chainid=56/);
  assert.equal(publicBsc.largeTransfers?.length, 1);
  assert.equal(publicBsc.largeTransfers?.[0].amount, 6);
  assert.equal(publicBsc.largeTransfers?.[0].estimatedUsd, 3_600);

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
  assert.match(wrongChain.unavailableReason ?? '', /expected chainid=1/);

  resetSolanaOnChainCacheForTests();
  setEnv('SBK1_WHALE_MIN_SOL', '10');
  setEnv('HELIUS_API_KEY', 'test-helius-key');
  const underThreshold = await fetchSolanaOnChainData({
    pair: 'SOL/USDT:USDT',
    nowMs: nowMs + 20_000,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getTransactionsForAddress') {
        return Response.json({
          jsonrpc: '2.0',
          result: [{
            signature: solSignature,
            slot: 301,
            timestamp: Math.floor((nowMs + 20_000) / 1_000),
            nativeTransfers: [{ toUserAccount: solWallet, amount: 9_000_000_000 }],
          }],
        });
      }
      return Response.json({
        jsonrpc: '2.0',
        result: { value: [{ confirmationStatus: 'confirmed', err: null }] },
      });
    },
  });
  assert.equal(underThreshold.status, 'LIVE');
  assert.deepEqual(underThreshold.largeTransfers, []);

  console.log('SOL/XRP/BNB on-chain providers, keyless Solana/BSC fallbacks, network isolation, threshold, confirmation and abstention checks passed.');
} finally {
  for (const name of envNames) setEnv(name, originalEnv[name]);
  resetSolanaOnChainCacheForTests();
  resetXrpOnChainCacheForTests();
  resetBscOnChainCacheForTests();
}
