# On-chain Provider Health Audit

## Scope and interpretation

This audit covers the 30 rows in `src/services/onChainFeedRegistry.ts` and the provider health state collected by `src/services/onChainProviderHealth.ts`. Registry rows are feed definitions, not 30 independent providers. Multiple feeds and URLs often belong to one operator and must not increase quorum independently.

Health state is in-memory and is not an historical uptime log. HTTP 429 and 503 responses update provider score and cooldown; ordinary transport failures and malformed application payloads are reported by adapters but do not produce a durable provider-history record. The classifications below are a snapshot, not an SLA or statistically meaningful uptime rate. `UNOBSERVED` means there is no evidence in this run and must not be interpreted as dead.

## Live snapshot

Captured by `npm run test:member6-live-dry-run` at **2026-11-03 11:22:18 UTC**:

- 15 endpoint origins were observed by the provider health tracker.
- 13 observed origins returned HTTP 2xx; two origins were rate-limited and cooling down: Solana Foundation and BlastAPI Ethereum.
- The registry-row HTTP audit counted 20 HTTP-success rows, 4 rate-limited rows, 0 other HTTP failures, and 6 unobserved rows. HTTP success alone does not prove that the response contained valid chain data.
- No provider can be classified as persistently dead from this single run. No removal is recommended without repeated, timestamped failures.
- BTC, ETH, BNB, and XRP produced fresh live data with at least two independent operators. SOL did not: only one provider completed the sample, and the Solana Foundation endpoint returned HTTP 429.
- All five Member 6 votes were `ABSTAIN`; large unattributed transfers and topology diagnostics are not directional proof.

### Candidate store at snapshot time

Counts are persisted in the local candidate store, not just candidates from the latest flow. “Active” means last activity within the previous 15 minutes. Seeded and dynamically discovered counts are disjoint origin categories; legacy records without origin are treated as dynamically discovered.

| Asset | Stored | Active (15m) | Historical-seed | Realtime-discovered | Active seeded | Active realtime |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 0 | 0 | 0 | 0 | 0 | 0 |
| ETH | 24 | 11 | 0 | 24 | 0 | 11 |
| SOL | 0 | 0 | 0 | 0 | 0 | 0 |
| BNB | 19 | 10 | 0 | 19 | 0 | 10 |
| XRP | 0 | 0 | 0 | 0 | 0 | 0 |

These are unverified candidate addresses. They do not become exchange labels or independently authorize votes.

## Classifications

### کارآمد و پایدار — live chain sample/quorum contribution

These providers returned HTTP success and contributed to valid chain samples in this run; this does not assert long-term uptime.

| Asset | Provider / operator | Endpoint(s) | Snapshot |
|---|---|---|---|
| BTC | mempool.space | `https://mempool.space/api` | HTTP 200 observed; BTC flow LIVE, 3 independent operators |
| BTC | Blockstream | `https://blockstream.info/api` | HTTP 200 observed; BTC flow LIVE, 3 independent operators |
| BTC | BTCscan | `https://btcscan.org/api` | HTTP 200 observed; BTC flow LIVE, 3 independent operators |
| ETH | PublicNode | `https://ethereum.publicnode.com/` | HTTP 200 observed; operator contributes one quorum vote |
| ETH | dRPC | `https://eth.drpc.org/` | HTTP 200 observed |
| ETH | Flashbots | `https://rpc.flashbots.net` | HTTP 200 observed |
| SOL | PublicNode | `https://solana-rpc.publicnode.com/` | HTTP 200 observed; alone it did not satisfy two-operator quorum |
| BNB | Binance | `https://bsc-dataseed.binance.org/` | HTTP 200 observed |
| BNB | PublicNode | `https://bsc-rpc.publicnode.com/` | HTTP 200 observed |
| BNB | BlastAPI | `https://bsc-mainnet.public.blastapi.io` | HTTP 200 observed |
| BNB | Defibit | `https://bsc-dataseed1.defibit.io/` | HTTP 200 observed |
| XRP | Ripple | `https://s1.ripple.com:51234/` | HTTP 200 observed; one independent operator |
| XRP | XRPL Cluster | `https://xrplcluster.com/` | HTTP 200 observed; second independent operator, XRP flow LIVE in this run |
### دارای خطای لیمیت/قطعی موقت — unstable / rate-limited

| Asset | Provider / endpoint | Evidence | Handling |
|---|---|---|---|
| SOL | Solana Foundation, `https://api.mainnet-beta.solana.com/` | HTTP 429 in this run; overall SOL sample lacked quorum | Endpoint cooldown and failover apply; provider alone cannot authorize a vote |
| ETH | BlastAPI, `https://eth-mainnet.public.blastapi.io` | HTTP 429 in this run; ETH still had three independent successful operators | Cooldown/failover preserves quorum in this snapshot |
| XRP | XRPL Cluster HTTP mirrors `https://xrpl.ws/`, `https://xrpl.link/` | Prior live attempts reported malformed ledger transaction/metadata payloads and request aborts; both mirrors were unobserved in this snapshot and share the XRPL Cluster operator. | Sequential fallback is bounded; mirrors do not add quorum |
| BTC | Mempool.space, Blockstream, BTCscan | Some live attempts rejected stale/future-dated block samples even where requests succeeded | Stale samples are excluded; other operators can still provide quorum |

XRP's malformed-response errors were intermittent and did not prevent quorum in this snapshot. These are application-level/provider availability findings, not proof the endpoints are permanently unusable.

### غیرقابل اتکا / نیازمند حذف — removal candidates

**None established by the available evidence.** The current monitor does not retain historical error rates, and this one live snapshot cannot support a “dead provider” conclusion. Do not remove endpoints based solely on an unobserved status or a single failure. Repeated failures should be accumulated before moving an endpoint here.

## Registry inventory and alias caveats

The feed registry includes:

- **BTC (6 rows):** three Esplora operators, each exposing blocks and recent mempool transactions.
- **ETH (6 rows):** PublicNode aliases/repeated rows, dRPC, BlastAPI, and Flashbots. PublicNode rows share one operator and do not provide independent quorum.
- **SOL (6 rows):** finalized-slot, block-list, and full-transaction rows for the Solana Foundation and PublicNode; each operator contributes at most one vote.
- **BNB (6 rows):** Binance DataSeed aliases, PublicNode, BlastAPI, and Defibit. Binance aliases share one operator.
- **XRP (6 rows):** XRPSCAN account transaction API plus Ripple RPCs and XRPL Cluster HTTP mirrors. The Ripple URLs share one operator; XRPL mirrors share one operator. XRPSCAN requires wallet account queries and was not a general ledger source in this run.

### Per-feed inventory and snapshot status

The following covers every registry row. HTTP status and application-level validity are shown separately where relevant.

| Asset | Registry endpoints / rows | Snapshot result |
|---|---|---|
| BTC | `mempool.space/api/v1/blocks`, `mempool.space/api/mempool/recent`; `blockstream.info/api/blocks`, `blockstream.info/api/mempool/recent`; `btcscan.org/api/blocks`, `btcscan.org/api/mempool/recent` | All six rows mapped to HTTP 200 origins; the adapter obtained live 3-operator quorum. Some separate attempts rejected stale block samples. |
| ETH | `ethereum-rpc.publicnode.com/` (unobserved); `ethereum.publicnode.com/` (two registry rows, HTTP 200); `eth.drpc.org/`, `rpc.flashbots.net` (HTTP 200); `eth-mainnet.public.blastapi.io` (HTTP 429) | Live 3-operator quorum. PublicNode aliases count as one operator; BlastAPI was not required for quorum. |
| SOL | `api.mainnet-beta.solana.com/` (three feed rows, HTTP 429); `solana-rpc.publicnode.com/` (three feed rows, HTTP 200) | One of two independent operators succeeded; SOL failed quorum. The three rows per endpoint do not add operator independence. |
| BNB | `bsc-dataseed.binance.org/` and `bsc-dataseed.binance.org` (HTTP 200, Binance); `bsc-dataseed2.binance.org/` (unobserved); `bsc-rpc.publicnode.com/`, `bsc-mainnet.public.blastapi.io`, `bsc-dataseed1.defibit.io/` (HTTP 200) | Live 4-operator quorum. Binance endpoint aliases count as one operator. |
| XRP | `api.xrpscan.com/api/v1/account/{address}/transactions?limit=10` (unobserved); `s1.ripple.com:51234/` (HTTP 200); `s2.ripple.com:51234/` (unobserved); `xrplcluster.com/` (HTTP 200); `xrpl.ws/`, `xrpl.link/` (unobserved; prior mirror attempts returned malformed data) | XRP had two valid independent operators in this snapshot. Ripple RPCs count as one operator and XRPL Cluster mirrors count as one operator. |

The Solana adapter also supports the optional Helius RPC when configured. It is not a keyless registry source and was not included in this keyless live quorum snapshot. XRP scanning is bounded to ten recent validated ledgers. These adapter limits and distinct-operator quorum rules remain in force.

### XRP stale-source remediation

The stale CoinPaprika XRP ticker was removed from Member 6's six-source set and replaced by Ripple S1's validated-ledger RPC health check (`onchain.ripple-s1-xrp`). It verifies fresh validated-ledger metadata rather than market-price context. Ripple S1 and S2 belong to the same operator and count as one operator for quorum; the replacement does not increase quorum independence.

## Reproducible diagnostics

- `npm run test:member6-live-dry-run` prints per-asset stored/active/seeded/dynamic candidate counts, current flow/vote results, provider-origin health, and a classification of every registry feed row as successful, rate-limited/failing, or unobserved for that process run. No orders are sent.
- `npm run seed:onchain-whales` manually runs a bounded historical scan: 144 BTC blocks (all transaction pages), 1,000 ETH blocks, 1,000 BNB blocks, 200 finalized Solana slots, and at most ten validated XRP ledgers. Historical scans are not run at startup. Only transfers confirmed by two independent operators are added as unverified candidates; per-asset failures are isolated and may cause a non-zero exit.
- The same command prints and writes a per-asset consensus matrix (0, 1, 2, 3, 4+ unique source IDs per stored candidate) plus per-endpoint `VALID` / `THROTTLED` / `FAILED` participation. `VALID` means the adapter accepted fresh, schema-valid data; multiple endpoints under one operator still count as only one quorum operator. Candidate labels remain unverified.

For operational uptime claims, persist timestamped provider-health samples across process restarts and calculate rates over a defined observation period. The current health map intentionally is bounded and in-memory only.
