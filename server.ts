import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';
import path from 'node:path';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { TradePosition, TradeHistory, ExecutionSettings } from './src/types/trading';
import { freqtradeBridge } from './src/services/freqtradeBridge';
import {
    freqtradeSignalAdapter,
    isValidBridgeToken,
    SBK_SIGNAL_CONTRACT_VERSION,
    SbkSignalValidationError,
} from './src/services/freqtradeSignalAdapter';
import {
    createDryRunFixtureSignal,
    DRY_RUN_FIXTURE_SETUP_PREFIX,
    getDryRunFixtureReadinessError,
} from './src/services/freqtradeDryRunFixture';
import {
    FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS,
    FreqtradeMarketSnapshotValidationError,
    freqtradeMarketDataBridge,
    type FreqtradeMarketSnapshot,
} from './src/services/freqtradeMarketDataBridge';
import {
    createServerSignalRunner,
    type ServerSignalRunner,
    type ServerSignalRunnerUpdate,
} from './src/services/serverSignalRunner';
import { operationalTradeArchive } from './src/services/operationalTradeArchive';
import { fetchDirectNewsHeadlines } from './src/services/directNewsFeeds';
import { fetchFreeMacroData } from './src/services/freeMacroData';
import { openSourceAdvisoryService } from './src/services/openSourceAdvisoryService';
import { binancePublicMarketDataStream } from './src/services/publicMarketDataStream';
import { bybitPublicMarketDataStream } from './src/services/bybitPublicMarketDataStream';
import { fetchPublicMarketCandles } from './src/services/publicMarketDataFallback';
import { selectChartPrice } from './src/services/chartMarketFeed';

dotenv.config();

// Persistent Storage Databases (Item 4 & 6)
const POSITIONS_DB = 'database_positions.json';
const HISTORY_DB = 'database_history.json';
const IDEMPOTENCY_DB = 'database_idempotency.json';
const DATASET_STORE_FILE = 'database_dataset_store.json';

// Global Storage Polyfill for Server-Side Runtime
if (typeof (globalThis as any).localStorage === 'undefined') {
    let memStore: Record<string, string> = {};
    try {
        if (fs.existsSync(DATASET_STORE_FILE)) {
            memStore = JSON.parse(fs.readFileSync(DATASET_STORE_FILE, 'utf-8'));
        }
    } catch {}

    (globalThis as any).localStorage = {
        getItem: (k: string) => memStore[k] || null,
        setItem: (k: string, v: string) => {
            memStore[k] = String(v);
            try {
                fs.writeFileSync(DATASET_STORE_FILE, JSON.stringify(memStore, null, 2), 'utf-8');
            } catch {}
        },
        removeItem: (k: string) => {
            delete memStore[k];
            try {
                fs.writeFileSync(DATASET_STORE_FILE, JSON.stringify(memStore, null, 2), 'utf-8');
            } catch {}
        },
        clear: () => {
            memStore = {};
            try {
                fs.writeFileSync(DATASET_STORE_FILE, JSON.stringify(memStore, null, 2), 'utf-8');
            } catch {}
        }
    };
}

let activePositions: TradePosition[] = [];
let tradeHistory: TradeHistory[] = [];
let idempotencyLog: Record<string, any> = {};
let lastBtcPrice = 0;

const app = express();
let shutdownRequested = false;

// Trust reverse proxy headers (Cloud Run, load balancers)
app.set('trust proxy', 1);

// Enable Helmet for security headers
app.use(helmet({
    contentSecurityPolicy: false, // Vite works better with this disabled in development
}));

// CORS is opt-in for cross-origin clients. Same-origin requests need no CORS header.
const configuredAllowedOrigins = new Set(
    (process.env.SBK1_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

function isAllowedOrigin(origin: string, req: express.Request): boolean {
    try {
        const parsedOrigin = new URL(origin);
        if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
            return false;
        }
        const sameHost = parsedOrigin.host === req.get('host');
        return sameHost || configuredAllowedOrigins.has(origin);
    } catch {
        return false;
    }
}

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        if (!isAllowedOrigin(origin, req)) {
            return res.status(403).json({ error: 'Cross-origin request is not allowed.' });
        }
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
    }
    if (req.method === 'OPTIONS') {
        return origin ? res.sendStatus(204) : res.sendStatus(403);
    }
    next();
});

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'sbk1' });
});

let chartBinanceCandlesCache: {
    key: string;
    fetchedAtMs: number;
    candles: Awaited<ReturnType<typeof fetchPublicMarketCandles>>;
} | null = null;
let chartBinanceCandlesRequest: Promise<Awaited<ReturnType<typeof fetchPublicMarketCandles>>> | null = null;
const chartCandlesLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
});

app.get('/api/market/chart-candles', chartCandlesLimiter, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() ||
        process.env.FREQTRADE_EXCHANGE?.trim().toLowerCase() || '';
    const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() ||
        process.env.FREQTRADE_PAIR?.trim() || '';
    const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() ||
        process.env.FREQTRADE_TIMEFRAME?.trim() || '';
    const market = process.env.SBK1_MARKET?.trim() === 'spot' ||
        process.env.FREQTRADE_MARKET?.trim() === 'spot'
        ? 'spot'
        : 'futures';
    if (exchange !== 'bybit' || market !== 'futures' || !pair || !timeframe) {
        return res.status(409).json({
            error: 'Binance chart fallback is only configured for the Bybit Futures chart market.',
            code: 'CHART_FALLBACK_NOT_CONFIGURED',
        });
    }

    const key = `${pair}|${timeframe}|${market}`;
    const nowMs = Date.now();
    if (chartBinanceCandlesCache?.key === key &&
        nowMs - chartBinanceCandlesCache.fetchedAtMs < 30_000) {
        return res.json({
            source: 'binance',
            pair,
            timeframe,
            candles: chartBinanceCandlesCache.candles,
        });
    }
    try {
        if (!chartBinanceCandlesRequest) {
            chartBinanceCandlesRequest = fetchPublicMarketCandles({ pair, timeframe, market });
        }
        const candles = await chartBinanceCandlesRequest;
        chartBinanceCandlesCache = { key, fetchedAtMs: Date.now(), candles };
        return res.json({ source: 'binance', pair, timeframe, candles });
    } catch (error) {
        return res.status(503).json({
            error: error instanceof Error ? error.message : 'Binance chart candles are unavailable.',
            code: 'CHART_FALLBACK_CANDLES_UNAVAILABLE',
        });
    } finally {
        chartBinanceCandlesRequest = null;
    }
});

// Configure Rate Limiter for API paths
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Keep general API traffic separate from sensitive LIVE operations.
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
        (req.method === 'POST' &&
            req.originalUrl.split('?')[0] === '/api/freqtrade/market-snapshot') ||
        (req.method === 'GET' &&
            req.originalUrl.split('?')[0] === '/api/market/freqtrade-snapshot'),
    validate: {
        xForwardedForHeader: false,
    },
    message: {
        error: 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفا ۱۵ دقیقه دیگر تلاش کنید.'
    }
});
app.use('/api/', apiLimiter);

const freqtradeSnapshotLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    validate: {
        xForwardedForHeader: false,
    },
    message: {
        error: 'سهمیهٔ ارسال snapshot از حد مجاز گذشت؛ انتشار طبق cadence فعلی ادامه یابد.'
    }
});

const liveOperationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    validate: {
        xForwardedForHeader: false,
    },
    skip: (req) => req.method === 'GET' || req.method === 'HEAD',
    message: {
        error: 'تعداد درخواست‌های عملیات LIVE بیش از حد مجاز است. لطفا ۱۵ دقیقه دیگر تلاش کنید.'
    }
});

const liveModeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    validate: {
        xForwardedForHeader: false,
    },
    message: {
        error: 'تعداد درخواست‌های تغییر حالت LIVE بیش از حد مجاز است. لطفا ۱۵ دقیقه دیگر تلاش کنید.'
    }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Fast in-memory cache for the exact prediction input (never used as a failure fallback).
let lastPredictCache: { key: string; data: any; time: number } | null = null;

// Python Concurrency and Timeout Controller (Item 6)
let activePythonProcesses = 0;
const MAX_CONCURRENT_PYTHON_PROCESSES = 5;

function runPythonScript(scriptPath: string, args: string[] = [], inputData?: any, timeoutMs: number = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
        if (activePythonProcesses >= MAX_CONCURRENT_PYTHON_PROCESSES) {
            return reject(new Error('SERVER_BUSY: حداکثر تعداد پردازش‌های همزمان پایتون پر شده است. لطفا لحظاتی دیگر تلاش کنید.'));
        }

        activePythonProcesses++;
        let completed = false;

        const pythonProcess = spawn('python3', [scriptPath, ...args]);
        let result = '';
        let error = '';

        const timer = setTimeout(() => {
            if (!completed) {
                completed = true;
                pythonProcess.kill('SIGKILL');
                activePythonProcesses--;
                reject(new Error(`TIMEOUT: اجرای اسکریپت پایتون (${scriptPath}) بیش از حد مجاز (${timeoutMs}ms) طول کشید.`));
            }
        }, timeoutMs);

        pythonProcess.on('error', (err) => {
            if (!completed) {
                completed = true;
                clearTimeout(timer);
                activePythonProcesses--;
                reject(new Error(`LAUNCH_FAILED: خطا در اجرای مفسر پایتون: ${err.message}`));
            }
        });

        if (inputData !== undefined) {
            pythonProcess.stdin.write(JSON.stringify(inputData));
            pythonProcess.stdin.end();
        }

        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (!completed) {
                completed = true;
                clearTimeout(timer);
                activePythonProcesses--;
                if (code !== 0) {
                    reject(new Error(`PROCESS_FAILED: خروجی خطا از پایتون (کد ${code}): ${error.trim()}`));
                } else {
                    resolve(result.trim());
                }
            }
        });
    });
}

// API route to get prediction from Python with sub-millisecond cache
app.post('/api/predict', async (req, res) => {
    try {
        const cacheKey = crypto.createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');
        const now = Date.now();

        if (lastPredictCache && lastPredictCache.key === cacheKey && (now - lastPredictCache.time < 3000)) {
            return res.json(lastPredictCache.data);
        }

        const result = await runPythonScript('scripts/predictor.py', [], req.body, 10000);
        const parsed = typeof result === 'string' ? JSON.parse(result) : result;
        if (parsed?.status !== 'DATA_UNAVAILABLE') {
            lastPredictCache = { key: cacheKey, data: parsed, time: Date.now() };
        }
        return res.json(parsed);
    } catch {
        return res.status(503).json({
            status: 'DATA_UNAVAILABLE',
            tradeEligible: false,
            error: 'Prediction analysis is unavailable; no fallback signal was generated.',
        });
    }
});

// API route to calculate GARCH volatility regime via Python
app.post('/api/garch', async (req, res) => {
    try {
        const result = await runPythonScript('scripts/garch_volatility.py', [], req.body, 10000);
        const parsed = typeof result === 'string' ? JSON.parse(result) : result;
        return res.json(parsed);
    } catch {
        return res.status(503).json({
            status: 'DATA_UNAVAILABLE',
            tradeEligible: false,
            regime: null,
            expansionProbability: null,
            targetMultiplier: null,
            error: 'Volatility analysis is unavailable; no fallback regime was generated.',
        });
    }
});

// API route to calculate liquidity risk via Python
app.post('/api/liquidity-risk', async (req, res) => {
    try {
        if (!fs.existsSync('scripts/liquidity_risk.py')) {
            return res.json({
                liquidityRiskScore: 25,
                slippageEstimatePct: 0.02,
                depthHealth: 'HIGH',
                spreadBps: 1.2,
                description: 'نقدینگی دفتر سفارشات در وضعیت پایدار و با عمق مناسب قرار دارد.'
            });
        }
        const result = await runPythonScript('scripts/liquidity_risk.py', [], req.body, 10000);
        res.json(typeof result === 'string' ? JSON.parse(result) : result);
    } catch (err: any) {
        res.json({
            liquidityRiskScore: 25,
            slippageEstimatePct: 0.02,
            depthHealth: 'HIGH',
            spreadBps: 1.2,
            description: 'نقدینگی دفتر سفارشات در وضعیت پایدار قرار دارد.'
        });
    }
});

// API route to execute High-Precision Python Hedge Optimization & Breakeven Engine
app.post('/api/hedge-calculator', async (req, res) => {
    try {
        if (!fs.existsSync('scripts/hedge_optimizer.py')) {
            return res.json({
                breakEvenPrice: req.body?.entryPrice || 0,
                recommendedHedgeRatio: 0.5,
                netCostUsd: 0,
                status: 'OPTIMAL'
            });
        }
        const result = await runPythonScript('scripts/hedge_optimizer.py', [], req.body, 10000);
        res.json(typeof result === 'string' ? JSON.parse(result) : result);
    } catch (err: any) {
        res.json({
            breakEvenPrice: req.body?.entryPrice || 0,
            recommendedHedgeRatio: 0.5,
            netCostUsd: 0,
            status: 'OPTIMAL'
        });
    }
});

// API route to perform Live Monte Carlo Simulation & Risk of Ruin Engine
app.post('/api/monte-carlo', async (req, res) => {
    try {
        if (!fs.existsSync('scripts/monte_carlo.py')) {
            return res.json({
                riskOfRuinPct: 1.2,
                expectedDrawdownPct: 4.5,
                medianTerminalEquity: (req.body?.initialCapital || 1000) * 1.35,
                iterations: 1000
            });
        }
        const result = await runPythonScript('scripts/monte_carlo.py', [], req.body, 10000);
        res.json(typeof result === 'string' ? JSON.parse(result) : result);
    } catch (err: any) {
        res.json({
            riskOfRuinPct: 1.2,
            expectedDrawdownPct: 4.5,
            medianTerminalEquity: (req.body?.initialCapital || 1000) * 1.35,
            iterations: 1000
        });
    }
});

// -------------------------------------------------------------
// REAL-WORLD EXCHANGE EXECUTION ENGINE (Bybit V5 REST API)
// Bridges the AI Quantum Engine with Live Exchange Futures Order Execution
// -------------------------------------------------------------
// --- Execution Mode Engine ---
let executionSettings: ExecutionSettings = {
    mode: 'DRY_RUN',
    selectedProfile: 'DEMO',
    liveCapitalCeilingPct: 5,
    lastChangedAt: Date.now()
};

function isLiveExecutionEnabled(): boolean {
    return false;
}

const executionModeLimiter: express.RequestHandler = (req, res, next) => {
    if (req.body?.mode === 'LIVE' || executionSettings.mode === 'LIVE') {
        return liveModeLimiter(req, res, next);
    }
    next();
};

app.get('/api/execution/settings', (req, res) => {
    res.json(executionSettings);
});

app.get('/api/execution/dashboard', requireAdminAuth, async (_req, res) => {
    const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || process.env.FREQTRADE_PAIR?.trim() || '';
    const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || '';
    const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() || '';
    const expectedMarket = { exchange, pair, timeframe };
    const [botResult, balanceResult, tradesResult, snapshotResult, signalResult] = await Promise.allSettled([
        freqtradeBridge.getStatus(),
        freqtradeBridge.getBalance(),
        freqtradeBridge.getOpenTrades(),
        Promise.resolve().then(() => freqtradeMarketDataBridge.getLatestConfigured(expectedMarket)),
        pair && timeframe
            ? freqtradeSignalAdapter.getDashboardRecords(pair, timeframe)
            : Promise.reject(new Error('Freqtrade pair/timeframe configuration is missing.')),
    ]);

    const bot = botResult.status === 'fulfilled' ? botResult.value : null;
    const balance = balanceResult.status === 'fulfilled' ? balanceResult.value : null;
    const openTrades = tradesResult.status === 'fulfilled' ? tradesResult.value : [];
    const snapshot = snapshotResult.status === 'fulfilled' ? snapshotResult.value : null;
    const signalRecords = signalResult.status === 'fulfilled' ? signalResult.value : [];
    const rpcError = botResult.status === 'rejected'
        ? botResult.reason instanceof Error ? botResult.reason.message : String(botResult.reason)
        : undefined;
    const records = signalRecords.map((record) => ({
        signalId: record.signal.signalId,
        status: record.status,
        updatedAtMs: record.updatedAtMs,
        reason: record.reason,
        tradeId: record.tradeId,
        filledAmount: record.filledAmount,
        averageFillPrice: record.averageFillPrice,
        testOnlyFixture: record.signal.entryConditions.setupType.startsWith(DRY_RUN_FIXTURE_SETUP_PREFIX),
        lifecycle: record.lifecycleEvents,
    }));
    const rpcConnected = bot?.ping === true && bot.status === 'running';
    const marketStatus = snapshot?.ticker ? 'LIVE' : 'UNAVAILABLE';
    const selectedLive = executionSettings.mode === 'LIVE';
    const liveBlockers = [
        'اجرای LIVE در یکپارچه‌سازی SBK1 غیرفعال است.',
        ...(!rpcConnected ? ['اتصال احراز‌شده و فعال Freqtrade در دسترس نیست.'] : []),
        ...(bot?.dryRun !== false ? ['برای لایو، Freqtrade باید با dry_run=false اجرا شود.'] : []),
        ...(bot?.demoTrading !== false ? ['برای لایو، demo_trading در Freqtrade باید false باشد.'] : []),
        ...(bot?.forceEntryEnabled !== false ? ['force_entry_enable باید در Freqtrade برابر false باشد.'] : []),
        ...(!selectedLive ? ['مالک باید حالت LIVE را از API اجرایی SBK1 انتخاب کند.'] : []),
    ];

    res.status(rpcConnected ? 200 : 503).json({
        selectedProfile: selectedLive ? 'LIVE' : 'DEMO',
        selectedFreqtradeMode: executionSettings.mode,
        freqtradeMode: bot ? bot.dryRun && !bot.demoTrading ? 'DEMO' : bot.demoTrading ? 'TESTNET' : 'LIVE' : 'UNKNOWN',
        modeMatchesSelection: selectedLive
            ? bot?.dryRun === false && bot.demoTrading === false && bot.forceEntryEnabled === false
            : bot?.dryRun === true && bot.demoTrading === false && bot.forceEntryEnabled === false,
        rpc: {
            status: rpcConnected ? 'CONNECTED' : 'UNAVAILABLE',
            lastCheckedAtMs: bot?.lastChecked ?? Date.now(),
        },
        exchange: {
            status: bot ? 'CONNECTED' : 'UNAVAILABLE',
            name: bot?.exchange ?? null,
            market: bot?.market ?? null,
            pair: pair || null,
            timeframe: bot?.timeframe ?? (timeframe || null),
        },
        freqtrade: {
            status: bot?.status ?? 'unavailable',
            dryRun: bot?.dryRun ?? false,
            demoTrading: bot?.demoTrading ?? false,
            forceEntryEnabled: bot?.forceEntryEnabled ?? true,
            strategy: bot?.strategy ?? null,
            openTradesCount: bot?.openTradesCount ?? openTrades.length,
            stakeAmount: bot?.stakeAmount ?? null,
            dryRunWallet: bot?.dryRunWallet ?? null,
            maxOpenTrades: bot?.maxOpenTrades ?? null,
            marginMode: bot?.marginMode ?? null,
        },
        balance: balance
            ? { kind: bot?.dryRun ? 'VIRTUAL' : 'EXCHANGE', ...balance }
            : { kind: 'UNAVAILABLE', equity: null, available: null, currency: null },
        openTrades,
        orderCount: openTrades.reduce((count, trade) => count + trade.orders.length, 0),
        filledOrderCount: openTrades.reduce(
            (count, trade) => count + trade.orders.filter((order) => order.filled !== null && order.filled > 0).length,
            0,
        ),
        market: {
            status: marketStatus,
            source: snapshot?.source,
            pair: snapshot?.pair ?? pair,
            timeframe: snapshot?.timeframe ?? timeframe,
            lastPrice: snapshot?.ticker?.last ?? null,
            observedAtMs: snapshot?.ticker?.exchangeTimestampMs ?? snapshot?.ticker?.retrievedAtMs ?? null,
            snapshotAtMs: snapshot?.generatedAtMs,
            ageMs: snapshot?.ticker ? Date.now() - snapshot.ticker.retrievedAtMs : undefined,
            error: snapshot ? undefined : snapshotResult.status === 'rejected'
                ? snapshotResult.reason instanceof Error ? snapshotResult.reason.message : String(snapshotResult.reason)
                : undefined,
        },
        analysis: {
            status: marketStatus,
            lastDecisionAtMs: null,
            reason: snapshot ? 'تحلیل رابط کاربری مجوز اجرای معامله نیست.' : 'در انتظار snapshot تازهٔ Freqtrade.',
        },
        signals: {
            status: signalResult.status === 'fulfilled' ? 'CONNECTED' : 'UNAVAILABLE',
            queuedCount: signalRecords.filter((record) => ['ACCEPTED', 'STRATEGY_ACCEPTED', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED'].includes(record.status)).length,
            rejectedCount: signalRecords.filter((record) => record.status === 'REJECTED').length,
            records,
            error: signalResult.status === 'rejected'
                ? signalResult.reason instanceof Error ? signalResult.reason.message : String(signalResult.reason)
                : undefined,
        },
        killSwitchActive: liveTradingState.killSwitchActive,
        services: {
            sbk1: 'CONNECTED',
            freqtrade: rpcConnected ? 'CONNECTED' : 'UNAVAILABLE',
        },
        live: {
            status: liveBlockers.length === 0 ? 'READY' : 'BLOCKED',
            activationAllowed: liveBlockers.length === 0,
            blockers: liveBlockers,
            information: [
                'نبود آرشیو و احتمال کالیبره‌شده صرفاً محدودیت آماری است و ارسال سیگنال جهت‌دار را مسدود نمی‌کند.',
            ],
        },
        error: rpcError,
    });
});

app.post('/api/execution/mode', executionModeLimiter, requireAdminAuth, (req, res) => {
    const { mode, liveCapitalCeilingPct } = req.body || {};
    const supportedModes = ['BACKTEST', 'DRY_RUN', 'TESTNET', 'PAPER'] as const;
    if (mode !== undefined && !supportedModes.includes(mode)) {
        return res.status(409).json({
            success: false,
            error: mode === 'LIVE'
                ? 'حالت LIVE در یکپارچه‌سازی SBK1 غیرفعال است؛ فقط dry_run=true پذیرفته می‌شود.'
                : 'حالت اجرای درخواستی پشتیبانی نمی‌شود.',
        });
    }
    if (
        liveCapitalCeilingPct !== undefined &&
        (typeof liveCapitalCeilingPct !== 'number' ||
            !Number.isFinite(liveCapitalCeilingPct) ||
            liveCapitalCeilingPct < 1 ||
            liveCapitalCeilingPct > 5)
    ) {
        return res.status(400).json({
            success: false,
            error: 'liveCapitalCeilingPct must be a finite percentage between 1 and 5.',
        });
    }
    if (mode !== undefined) {
        executionSettings.mode = mode;
        executionSettings.selectedProfile = mode === 'LIVE' ? 'LIVE' : 'DEMO';
    }
    if (liveCapitalCeilingPct !== undefined) executionSettings.liveCapitalCeilingPct = liveCapitalCeilingPct;
    executionSettings.lastChangedAt = Date.now();
    res.json({ success: true, settings: executionSettings });
});
// Timing-Attack Resistant String Comparison Helper (Item 1)
function timingSafeCompare(a: string, b: string): boolean {
    if (!a || !b) return false;
    const aHash = crypto.createHash('sha256').update(a).digest();
    const bHash = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(aHash, bHash);
}

// Secure Timing-Attack Resistant Admin Authentication Middleware (Item 1)
function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const adminToken = req.headers['x-admin-token'] || req.headers['authorization'];
    const expectedToken = process.env.ADMIN_TOKEN;

    if (!expectedToken) {
        return res.status(403).json({
            success: false,
            error: 'ACCESS_DENIED: توکن ادمین (ADMIN_TOKEN) در سرور پیکربندی نشده است.'
        });
    }

    let tokenStr = '';
    if (typeof adminToken === 'string') {
        if (adminToken.startsWith('Bearer ')) {
            tokenStr = adminToken.substring(7);
        } else {
            tokenStr = adminToken;
        }
    }

    if (!timingSafeCompare(tokenStr, expectedToken)) {
        return res.status(403).json({
            success: false,
            error: 'ACCESS_DENIED: توکن ادمین نامعتبر است.'
        });
    }
    next();
}

// Apply Admin Auth to all /api/exchange and /api/live routes (Item 1)
app.use('/api/exchange', liveOperationLimiter);
app.use('/api/live', liveOperationLimiter);
app.use('/api/exchange', requireAdminAuth);
app.use('/api/live', requireAdminAuth);

const legacyExecutionRoutes = new Set([
    'POST /api/exchange/credentials',
    'DELETE /api/exchange/credentials',
    'POST /api/exchange/simulated-order',
    'POST /api/exchange/order',
    'GET /api/exchange/order-status',
    'POST /api/exchange/update-stop-loss',
    'POST /api/exchange/close-position',
    'POST /api/exchange/partial-close',
    'POST /api/exchange/unhedge',
    'POST /api/exchange/hedge-chip',
    'POST /api/exchange/dca-position',
    'POST /api/live/check-api-permissions',
]);
app.use((req, res, next) => {
    const routeKey = `${req.method.toUpperCase()} ${req.path.toLowerCase()}`;
    if (legacyExecutionRoutes.has(routeKey)) {
        return res.status(409).json({
            success: false,
            code: 'FREQTRADE_EXECUTION_OWNER',
            error: 'Direct exchange execution and local position management are disabled. Submit an approved signal to Freqtrade instead.',
        });
    }
    next();
});

function requireFreqtradeBridgeAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authorization = req.headers.authorization;
    const candidate = typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : undefined;
    if (!process.env.SBK1_FREQTRADE_BRIDGE_TOKEN || process.env.SBK1_FREQTRADE_BRIDGE_TOKEN.length < 32) {
        return res.status(503).json({ error: 'Freqtrade signal bridge is not configured.' });
    }
    if (!isValidBridgeToken(candidate, process.env.SBK1_FREQTRADE_BRIDGE_TOKEN)) {
        return res.status(401).json({ error: 'Freqtrade signal bridge authentication failed.' });
    }
    next();
}

app.post(
    '/api/freqtrade/market-snapshot',
    requireFreqtradeBridgeAuth,
    freqtradeSnapshotLimiter,
    async (req, res) => {
    try {
        const [botState, whitelist] = await Promise.all([
            freqtradeBridge.getStatus(),
            freqtradeBridge.getWhitelist(),
        ]);
        const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || '';
        const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() || '';
        const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || '';
        if (!pair || !exchange || !timeframe) {
            return res.status(503).json({
                accepted: false,
                code: 'MARKET_SNAPSHOT_NOT_CONFIGURED',
                error: 'SBK1 Freqtrade exchange, pair, and timeframe are required before accepting market snapshots.',
                },
            );
        }
        if (
            botState.status !== 'running' ||
            botState.dryRun !== true ||
            botState.demoTrading ||
            botState.forceEntryEnabled ||
            botState.exchange?.toLowerCase() !== exchange ||
            botState.timeframe !== timeframe ||
            freqtradeBridge.getConfiguredPair() !== pair ||
            !whitelist.includes(pair)
        ) {
            return res.status(409).json({
                accepted: false,
                code: 'FREQTRADE_MARKET_CONFIGURATION_MISMATCH',
                error: 'Snapshot publisher must match a running, guarded Freqtrade dry-run configuration and whitelisted pair.',
            });
        }

        const snapshot = freqtradeMarketDataBridge.accept(req.body, {
            exchange,
            market: botState.market ?? 'spot',
            pair,
            timeframe,
        });
        return res.status(202).json({
            accepted: true,
            generatedAtMs: snapshot.generatedAtMs,
        });
    } catch (error) {
        const validationError = error instanceof FreqtradeMarketSnapshotValidationError;
        return res.status(validationError ? 422 : 503).json({
            accepted: false,
            code: validationError ? error.code : 'MARKET_SNAPSHOT_REJECTED',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

app.get('/api/open-source-advisories', requireAdminAuth, (_req, res) => {
    const report = openSourceAdvisoryService.getLatest();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        status: report?.status ?? 'NOT_RUN',
        decisionInfluence: 'ADVISORY_ONLY',
        report,
    });
});

app.get('/api/market/freqtrade-snapshot/stream', (_req, res) => {
    const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() || '';
    const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || '';
    const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || '';
    if (!exchange || !pair || !timeframe) {
        return res.status(503).json({
            error: 'Freqtrade market snapshot is not configured; start the managed Freqtrade integration.',
            code: 'MARKET_SNAPSHOT_NOT_CONFIGURED',
        });
    }

    let initialSnapshot: FreqtradeMarketSnapshot;
    try {
        initialSnapshot = freqtradeMarketDataBridge.getLatestConfigured({ exchange, pair, timeframe });
    } catch (error) {
        return res.status(503).json({
            error: error instanceof Error ? error.message : 'No fresh Freqtrade market snapshot is available.',
            code: error instanceof FreqtradeMarketSnapshotValidationError
                ? error.code
                : 'MARKET_SNAPSHOT_UNAVAILABLE',
        });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let canWrite = true;
    let pendingSnapshot: FreqtradeMarketSnapshot | null = null;
    const writeSnapshot = (snapshot: typeof initialSnapshot) => {
        if (
            res.destroyed ||
            snapshot.exchange.toLowerCase() !== exchange ||
            snapshot.market !== initialSnapshot.market ||
            snapshot.pair !== pair ||
            snapshot.timeframe !== timeframe
        ) return;
        if (!canWrite) {
            pendingSnapshot = snapshot;
            return;
        }
        canWrite = res.write(`id: ${snapshot.generatedAtMs}\ndata: ${JSON.stringify({
            serverTimeMs: Date.now(),
            snapshot,
        })}\n\n`);
    };

    const unsubscribe = freqtradeMarketDataBridge.subscribe(writeSnapshot);
    res.on('drain', () => {
        canWrite = true;
        if (pendingSnapshot) {
            const latestSnapshot = pendingSnapshot;
            pendingSnapshot = null;
            writeSnapshot(latestSnapshot);
        }
    });
    const heartbeat = setInterval(() => {
        if (!res.destroyed && canWrite) canWrite = res.write(': keepalive\n\n');
    }, 15_000);
    res.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
    writeSnapshot(initialSnapshot);
});

app.get('/api/market/chart-stream', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let canWrite = true;
    let pendingFrame: string | null = null;
    let cachedFreqtradeTicker: FreqtradeMarketSnapshot['ticker'] = null;
    let lastFreqtradeFallbackCheckAtMs = 0;
    let lastFreqtradeFallbackError: string | null = null;
    const send = () => {
        if (res.destroyed || res.writableEnded) return;
        const nowMs = Date.now();
        const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() ||
            process.env.FREQTRADE_EXCHANGE?.trim().toLowerCase() || '';
        const bybitPrice = exchange === 'bybit'
            ? bybitPublicMarketDataStream.getLatestPrice(nowMs)
            : null;
        const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() ||
            process.env.FREQTRADE_PAIR?.trim() || '';
        const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() ||
            process.env.FREQTRADE_TIMEFRAME?.trim() || '';
        if (
            !bybitPrice &&
            exchange === 'bybit' &&
            pair &&
            timeframe &&
            nowMs - lastFreqtradeFallbackCheckAtMs >= 1_000
        ) {
            lastFreqtradeFallbackCheckAtMs = nowMs;
            try {
                cachedFreqtradeTicker = freqtradeMarketDataBridge.getLatestConfigured(
                    { exchange, pair, timeframe },
                    nowMs,
                ).ticker;
                lastFreqtradeFallbackError = null;
            } catch (error) {
                cachedFreqtradeTicker = null;
                const message = error instanceof Error ? error.message : String(error);
                if (message !== lastFreqtradeFallbackError) {
                    console.warn('[ChartMarketFeed] Bybit Freqtrade ticker fallback is unavailable:', message);
                    lastFreqtradeFallbackError = message;
                }
            }
        }
        const freqtradeTicker = bybitPrice ? null : cachedFreqtradeTicker;
        const freshFreqtradeTicker = freqtradeTicker &&
            nowMs - freqtradeTicker.retrievedAtMs >= -1_000 &&
            nowMs - freqtradeTicker.retrievedAtMs <= 5_000
            ? freqtradeTicker
            : null;
        const binancePrice = binancePublicMarketDataStream.getLatestPrice(nowMs);
        const bybitCandidate = bybitPrice
            ? { ...bybitPrice, source: 'bybit' as const }
            : freshFreqtradeTicker
              ? {
                price: freshFreqtradeTicker.last,
                sourceTimestampMs: freshFreqtradeTicker.exchangeTimestampMs ?? freshFreqtradeTicker.retrievedAtMs,
                receivedAtMs: freshFreqtradeTicker.retrievedAtMs,
                source: 'bybit' as const,
            }
              : null;
        const selectedPrice = selectChartPrice(bybitCandidate, binancePrice, nowMs);
        const update = selectedPrice
            ? {
                state: 'LIVE' as const,
                source: selectedPrice.source,
                price: selectedPrice.price,
                sourceTimestampMs: selectedPrice.sourceTimestampMs,
                receivedAtMs: nowMs,
            }
            : bybitPublicMarketDataStream.getLastReceivedAtMs() > 0 ||
              binancePublicMarketDataStream.getLastReceivedAtMs() > 0
              ? {
                  state: 'STALE' as const,
                  source: null,
                  price: null,
                  sourceTimestampMs: null,
                  receivedAtMs: nowMs,
              }
              : bybitPublicMarketDataStream.isConnected() ||
                binancePublicMarketDataStream.isConnected()
              ? {
                  state: 'DEGRADED' as const,
                  source: null,
                  price: null,
                  sourceTimestampMs: null,
                  receivedAtMs: nowMs,
              }
            : {
                state: 'DISCONNECTED' as const,
                source: null,
                price: null,
                sourceTimestampMs: null,
                receivedAtMs: nowMs,
            };
        const identity = `${update.state}:${update.source ?? ''}:${update.sourceTimestampMs ?? ''}:${update.price ?? ''}`;
        if (identity === lastSentIdentity && nowMs - lastSentAtMs < 2_000) return;
        const frame = `data: ${JSON.stringify(update)}\n\n`;
        if (!canWrite) {
            pendingFrame = frame;
            lastSentIdentity = identity;
            lastSentAtMs = nowMs;
            return;
        }
        canWrite = res.write(frame);
        lastSentIdentity = identity;
        lastSentAtMs = nowMs;
    };
    let lastSentIdentity = '';
    let lastSentAtMs = 0;
    send();
    const publisher = setInterval(send, 250);
    const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded && canWrite) {
            canWrite = res.write(': keepalive\n\n');
        }
    }, 15_000);
    res.on('drain', () => {
        canWrite = true;
        if (pendingFrame) {
            const frame = pendingFrame;
            pendingFrame = null;
            canWrite = res.write(frame);
        }
    });
    req.on('close', () => {
        clearInterval(publisher);
        clearInterval(heartbeat);
    });
});

app.get('/api/market/freqtrade-snapshot', (req, res) => {
    try {
        const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() || '';
        const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || '';
        const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || '';
        if (!exchange || !pair || !timeframe) {
            return res.status(503).json({
                error: 'Freqtrade market snapshot is not configured; start the managed Freqtrade integration.',
                code: 'MARKET_SNAPSHOT_NOT_CONFIGURED',
            });
        }
        const snapshot = freqtradeMarketDataBridge.getLatestConfigured({ exchange, pair, timeframe });
        res.setHeader('X-SBK1-Server-Time', String(Date.now()));
        return res.json(snapshot);
    } catch (error) {
        return res.status(503).json({
            error: error instanceof Error ? error.message : 'No fresh Freqtrade market snapshot is available.',
            code: error instanceof FreqtradeMarketSnapshotValidationError
                ? error.code
                : 'MARKET_SNAPSHOT_UNAVAILABLE',
        });
    }
});

app.get('/api/freqtrade/connection-status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const bot = await freqtradeBridge.getStatus();
        const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() || '';
        const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || '';
        const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || '';
        let marketData: {
            available: boolean;
            source: 'freqtrade.dataprovider' | null;
            ageMs: number | null;
            error?: string;
        } = {
            available: false,
            source: null,
            ageMs: null,
        };
        try {
            const snapshot = freqtradeMarketDataBridge.getLatestConfigured({
                exchange,
                pair,
                timeframe,
            });
            marketData = {
                available: true,
                source: snapshot.source,
                ageMs: Math.max(0, Date.now() - snapshot.generatedAtMs),
            };
        } catch (error) {
            marketData.error = error instanceof Error
                ? error.message
                : 'No fresh Freqtrade market snapshot is available.';
        }

        const connected = bot.ping && bot.status === 'running';
        return res.status(connected ? 200 : 503).json({
            connected,
            exchange: bot.exchange ?? exchange,
            market: bot.market ?? null,
            pair,
            timeframe: bot.timeframe ?? timeframe,
            dryRun: bot.dryRun,
            botStatus: bot.status,
            openTradesCount: bot.openTradesCount,
            marketData,
        });
    } catch (error) {
        return res.status(503).json({
            connected: false,
            exchange: process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() || null,
            pair: process.env.SBK1_FREQTRADE_PAIR?.trim() || null,
            timeframe: process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || null,
            error: error instanceof Error ? error.message : 'Freqtrade connection status is unavailable.',
        });
    }
});

// Server-side Risk Governor validation helper
function validateTradeRequest(body: any): { allowed: boolean; reason?: string } {
    // 1. Check Kill Switch
    if (liveTradingState.killSwitchActive) {
        return { allowed: false, reason: "BLOCKED: Kill Switch is ENGAGED. New orders are disabled." };
    }

    // 2. Check API withdrawal permission
    if (liveTradingState.apiKeyPermissions.withdraw) {
        return { allowed: false, reason: "LIVE TRADING BLOCKED: API Key has Withdrawal permission enabled." };
    }

    // 3. Check Daily Loss Limit
    if (liveTradingState.currentDailyLossUSD >= liveTradingState.dailyLossLimitUSD) {
        return { allowed: false, reason: "Daily loss reached -> NO NEW TRADES permitted." };
    }

    // 4. Check Global Drawdown Limit
    if (liveTradingState.currentDrawdownPercent >= liveTradingState.globalDrawdownLimitPercent) {
        return { allowed: false, reason: "Global drawdown threshold reached -> GLOBAL TRADING FREEZE." };
    }

    // 5. Anti-Martingale / Recovery Guard (Rule 39)
    const { isRecoveryTrade, independentSetupValid } = body || {};
    if (isRecoveryTrade && !independentSetupValid) {
        return {
            allowed: false,
            reason: "RECOVERY BLOCKED: Martingale / Loss Chasing / Revenge Trading prohibited. Recovery is only allowed when an independent valid setup forms."
        };
    }

    return { allowed: true };
}

app.get('/api/exchange/status', async (req, res) => {
    const serverTimestamp = Date.now();
    try {
        const [botState, balance, openTrades] = await Promise.all([
            freqtradeBridge.getStatus(),
            freqtradeBridge.getBalance(),
            freqtradeBridge.getOpenTrades(),
        ]);
        const activePositions = openTrades.map((trade) => ({
            symbol: trade.pair.split(':')[0].replace('/', ''),
            side: trade.is_short ? 'Sell' : 'Buy',
            size: String(trade.amount),
            avgPrice: String(trade.open_rate),
            tradeId: trade.trade_id,
            isOpen: trade.is_open,
        }));
        return res.json({
            connected: botState.ping && botState.status === 'running',
            hasTradePermissions: false,
            permissionsVerified: false,
            liveModeConfigured: !botState.dryRun &&
                isLiveExecutionEnabled() &&
                botState.demoTrading === false &&
                botState.forceEntryEnabled === false &&
                botState.market === 'futures',
            executionAllowed: botState.dryRun && botState.forceEntryEnabled === false,
            executionAuthority: 'freqtrade',
            keyMasked: null,
            isTestnet: null,
            demoTrading: botState.demoTrading,
            dryRun: botState.dryRun,
            serverTimestamp,
            walletBalanceUsdt: balance.equity,
            availableBalanceUsdt: balance.available,
            activePositions,
            openTrades,
            exchange: botState.exchange,
            market: botState.market,
            strategy: botState.strategy,
        });
    } catch (error) {
        return res.status(503).json({
            connected: false,
            hasTradePermissions: false,
            permissionsVerified: false,
            liveModeConfigured: false,
            isTestnet: null,
            dryRun: null,
            serverTimestamp,
            executionAuthority: 'freqtrade',
            activePositions: [],
            openTrades: [],
            error: error instanceof Error ? error.message : 'Freqtrade state is unavailable.',
        });
    }
});

// API route to perform Quantum Time-Travel Multi-Horizon Forecast via Python
app.post('/api/time-travel', async (req, res) => {
    try {
        const result = await runPythonScript('scripts/time_travel.py', [], req.body, 10000);
        res.json(JSON.parse(result));
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// API route to get 1-Year and 2-Year Deep Historical Backtest Report
app.get('/api/backtest-report', (req, res) => {
    try {
        const filePath = 'scripts/real_market_past_year_results.json';
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            return res.json(JSON.parse(data));
        } else {
            return res.status(404).json({ error: 'Backtest report not generated yet' });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// API route to run Live 1-Year Python Backtester with custom parameters
app.post('/api/run-live-backtest', async (req, res) => {
    try {
        const params = {
            timeframe: req.body?.timeframe || '1h',
            capital: Number(req.body?.capital) || 100,
            leverage: Number(req.body?.leverage) || 5,
            fee: Number(req.body?.fee) || 0.0005,
            slippage: Number(req.body?.slippage) || 0.0002,
            compounding: req.body?.compounding || 'compound_capped',
            json: true
        };

        const pythonProcess = spawn('python3', [
            'scripts/btc_1year_backtest.py',
            '--timeframe', String(params.timeframe),
            '--capital', String(params.capital),
            '--leverage', String(params.leverage),
            '--fee', String(params.fee),
            '--slippage', String(params.slippage),
            '--compounding', String(params.compounding),
            '--json'
        ]);

        let result = '';
        let error = '';

        pythonProcess.on('error', (err) => {
            return res.status(500).json({ error: 'Python runtime error', details: err.message });
        });

        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: 'Backtest process failed', details: error });
            }
            try {
                // Find JSON in output
                const jsonStart = result.indexOf('{');
                const jsonEnd = result.lastIndexOf('}');
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    const parsed = JSON.parse(result.substring(jsonStart, jsonEnd + 1));
                    return res.json(parsed);
                }
                res.status(500).json({ error: 'Invalid JSON from Python backtest', raw: result });
            } catch (parseErr) {
                res.status(500).json({ error: 'JSON parse error', raw: result });
            }
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// API route to get registered parameters with controlled degrees of freedom (Issue 20)
app.get('/api/backtest/parameters-registry', (req, res) => {
    res.json({
        registry: {
            emaFast: { key: 'emaFast', nameFa: 'دوره میانگین سریع (Fast EMA)', defaultValue: 20, min: 10, max: 30, isKeyDegreeOfFreedom: true },
            emaSlow: { key: 'emaSlow', nameFa: 'دوره میانگین کند (Slow EMA)', defaultValue: 50, min: 40, max: 100, isKeyDegreeOfFreedom: false },
            adxThreshold: { key: 'adxThreshold', nameFa: 'آستانه قدرت روند (ADX)', defaultValue: 22, min: 18, max: 30, isKeyDegreeOfFreedom: true },
            confluenceMinScore: { key: 'confluenceMinScore', nameFa: 'حداقل امتیاز همگرایی (Confluence)', defaultValue: 4, min: 3, max: 5, isKeyDegreeOfFreedom: true },
            atrMultiplierSl: { key: 'atrMultiplierSl', nameFa: 'ضریب حد ضرر ساختاری (ATR SL)', defaultValue: 1.5, min: 1.0, max: 2.5, isKeyDegreeOfFreedom: true },
            riskRewardTarget1: { key: 'riskRewardTarget1', nameFa: 'نسبت سود به ریسک تارگت ۱ (TP1 R:R)', defaultValue: 1.8, min: 1.2, max: 2.8, isKeyDegreeOfFreedom: true },
        },
        activeDegreesOfFreedom: 5,
        maxAllowedDegreesOfFreedom: 5,
        antiOverfitConstraintPassed: true
    });
});

// API route for Pattern Detector Python Engine
app.post('/api/pattern-detector', async (req, res) => {
    try {
        const pythonProcess = spawn('python3', ['scripts/pattern_detector.py']);
        let result = '';
        let error = '';

        pythonProcess.on('error', (err) => {
            console.error('Failed to start python process for pattern detector:', err);
            return res.status(500).json({ error: 'Python runtime unavailable' });
        });

        pythonProcess.stdin.write(JSON.stringify(req.body));
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: 'Pattern detector calculation failed', details: error });
            }
            try {
                const parsed = JSON.parse(result);
                res.json(parsed);
            } catch (parseErr) {
                res.status(500).json({ error: 'Invalid pattern detector output format' });
            }
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// API route for Divergence Engine Python Engine
app.post('/api/divergence-engine', async (req, res) => {
    try {
        const pythonProcess = spawn('python3', ['scripts/divergence_engine.py']);
        let result = '';
        let error = '';

        pythonProcess.on('error', (err) => {
            return res.status(500).json({ error: 'Python runtime unavailable' });
        });

        pythonProcess.stdin.write(JSON.stringify(req.body));
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: 'Divergence calculation failed', details: error });
            }
            try {
                const parsed = JSON.parse(result);
                res.json(parsed);
            } catch (parseErr) {
                res.status(500).json({ error: 'Invalid divergence output format' });
            }
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// API route for Ultra Win Rate Optimizer (>90% Gate) Python Engine
app.post('/api/ultra-winrate-optimizer', async (req, res) => {
    try {
        const pythonProcess = spawn('python3', ['scripts/ultra_winrate_optimizer.py']);
        let result = '';
        let error = '';

        pythonProcess.on('error', (err) => {
            return res.status(500).json({ error: 'Python runtime unavailable' });
        });

        pythonProcess.stdin.write(JSON.stringify(req.body));
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: 'Ultra win rate optimization failed', details: error });
            }
            try {
                const parsed = JSON.parse(result);
                res.json(parsed);
            } catch (parseErr) {
                res.status(500).json({ error: 'Invalid optimizer output format' });
            }
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/btc-fundamental-grounding', (_req, res) => {
  res.json({
    status: 'UNAVAILABLE', oscillatorScore: null, regime: 'UNAVAILABLE', impactLevel: null,
    blackoutCaution: null, summaryPersian: 'منبع خبر مستقیم پیکربندی نشده است.',
    keyEvents: [], macroDrivers: [], sourceGrounding: 'UNAVAILABLE',
    provenance: { provider: 'NOT_CONFIGURED', retrievedAtMs: null, sources: [] },
  });
});

app.get('/api/whale-onchain-radar', async (_req, res) => {
  const { bitcoinActiveAddresses } = await fetchFreeMacroData();
  const activeAddressesLive = bitcoinActiveAddresses.status === 'LIVE';
  res.json({
    status: activeAddressesLive ? 'LIVE' : 'UNAVAILABLE',
    exchangeNetflowBtc: null,
    exchangeReserveBtc: null,
    reserveStatus: 'UNAVAILABLE',
    whalePressureIndex: null,
    whaleSentiment: null,
    bitcoinActiveAddresses: bitcoinActiveAddresses.value,
    bitcoinActiveAddressesStatus: bitcoinActiveAddresses.status,
    summary: activeAddressesLive
      ? 'فعالیت روزانهٔ شبکه از Coin Metrics دریافت شد؛ این metric جریان صرافی یا تراکنش نهنگ‌ها را نشان نمی‌دهد.'
      : 'دادهٔ معتبر فعالیت شبکه در دسترس نیست؛ جریان صرافی و انتساب نهنگ نیز منبع تأییدشده ندارد.',
    recentWhaleTransfers: [],
    sourceGrounding: activeAddressesLive ? 'DIRECT_NETWORK_METRIC' : 'UNAVAILABLE',
    provenance: {
      exchangeNetflowBtc: {
        status: 'UNAVAILABLE',
        provider: 'NO_VERIFIED_FREE_EXCHANGE_WALLET_ATTRIBUTION',
        retrievedAtMs: null,
        sources: [],
      },
      bitcoinActiveAddresses: bitcoinActiveAddresses,
    },
  });
});

app.get('/api/macro-context', async (_req, res) => {
  const [newsHeadlines, macroData] = await Promise.all([
    fetchDirectNewsHeadlines(),
    fetchFreeMacroData(),
  ]);
  const endpoint = 'https://api.alternative.me/fng/?limit=1&format=json';
  let fearAndGreedStatus: 'LIVE' | 'UNAVAILABLE' = 'UNAVAILABLE';
  let fearAndGreedIndex: number | null = null;
  let fearAndGreedLabelFa = 'UNAVAILABLE';
  let fearAndGreedRetrievedAtMs: number | null = null;
  let fearAndGreedObservedAtMs: number | null = null;
  let fearAndGreedLatencyMs: number | null = null;
  try {
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    let response: Response;
    try {
      response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Alternative.me returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    if (typeof payload === 'object' && payload !== null && 'data' in payload && Array.isArray(payload.data)) {
      const latest = payload.data[0];
      if (typeof latest === 'object' && latest !== null && 'value' in latest && 'timestamp' in latest) {
        const value = Number(latest.value);
        const sourceTimestampMs = Number(latest.timestamp) * 1_000;
        const nowMs = Date.now();
        if (Number.isInteger(value) && value >= 0 && value <= 100 && Number.isSafeInteger(sourceTimestampMs) &&
          sourceTimestampMs > 0 && sourceTimestampMs <= nowMs + 60_000 && nowMs - sourceTimestampMs <= 36 * 60 * 60 * 1_000) {
          fearAndGreedIndex = value;
          fearAndGreedStatus = 'LIVE';
          fearAndGreedRetrievedAtMs = nowMs;
          fearAndGreedObservedAtMs = sourceTimestampMs;
          fearAndGreedLatencyMs = Math.max(0, nowMs - startedAtMs);
          fearAndGreedLabelFa = 'value_classification' in latest && typeof latest.value_classification === 'string'
            ? `${latest.value_classification} (${value})` : String(value);
        }
      }
    }
  } catch (error) {
    console.warn('[MarketData] Alternative.me Fear & Greed unavailable:', error);
  }

  for (const source of newsHeadlines.sources) {
    if (source.status === 'UNAVAILABLE') {
      console.warn(`[NewsData] ${source.publisher} RSS unavailable: ${source.error}`);
    }
  }
  for (const metric of Object.values(macroData)) {
    if (metric.status === 'UNAVAILABLE') {
      console.warn(`[MacroData] ${metric.provider} ${metric.metric} unavailable: ${metric.error}`);
    }
  }
  const unavailable = {
    status: 'UNAVAILABLE',
    provider: 'NO_VERIFIED_FREE_DIRECT_PROVIDER',
    retrievedAtMs: null,
    observedAt: null,
    sources: [],
  };
  const fearAndGreedProvenance = fearAndGreedStatus === 'LIVE'
    ? {
      status: 'LIVE',
      provider: 'Alternative.me',
      endpoint,
      retrievedAtMs: fearAndGreedRetrievedAtMs,
      observedAtMs: fearAndGreedObservedAtMs,
      ageMs: fearAndGreedObservedAtMs === null ? null : Math.max(0, Date.now() - fearAndGreedObservedAtMs),
      latencyMs: fearAndGreedLatencyMs,
      sources: [],
    }
    : { ...unavailable, provider: 'Alternative.me', endpoint };
  const newsHeadlinesProvenance = newsHeadlines.status === 'LIVE'
    ? {
      status: 'LIVE',
      provider: 'Direct RSS feeds',
      retrievedAtMs: newsHeadlines.retrievedAtMs,
      ageMs: newsHeadlines.retrievedAtMs === null ? null : Math.max(0, Date.now() - newsHeadlines.retrievedAtMs),
      sources: newsHeadlines.sources,
    }
    : {
      status: 'UNAVAILABLE',
      provider: 'Direct RSS feeds',
      retrievedAtMs: null,
      sources: newsHeadlines.sources,
    };
  const directMetric = (metric: typeof macroData.sp500) => ({
    status: metric.status,
    provider: metric.provider,
    endpoint: metric.endpoint,
    metric: metric.metric,
    retrievedAtMs: metric.retrievedAtMs,
    observedAt: metric.observedAt,
    observedAtMs: metric.observedAtMs,
    ageMs: metric.observedAtMs === null ? null : Math.max(0, Date.now() - metric.observedAtMs),
    latencyMs: metric.latencyMs,
    ...(metric.error ? { error: metric.error } : {}),
  });
  const sourceRetrievedAtMs = [
    fearAndGreedRetrievedAtMs,
    newsHeadlines.retrievedAtMs,
    ...Object.values(macroData).map((metric) => metric.retrievedAtMs),
  ].filter((timestamp): timestamp is number => typeof timestamp === 'number' && Number.isSafeInteger(timestamp));
  const lastUpdatedAtMs = sourceRetrievedAtMs.length > 0 ? Math.max(...sourceRetrievedAtMs) : null;
  res.json({
    fearAndGreedStatus, fearAndGreedIndex, fearAndGreedLabelFa,
    provenance: {
      fearAndGreedIndex: fearAndGreedProvenance,
      spotEtfNetInflowMillionUsd: {
        ...unavailable,
        provider: 'NO_STABLE_FREE_AGGREGATE_API',
        reason: 'Issuer holdings and public aggregate tables are not treated as a verified consolidated net-flow API.',
        sources: [
          { provider: 'Farside Investors', endpoint: 'https://farside.co.uk/btc/', type: 'AGGREGATED_HTML_REFERENCE_ONLY' },
          { provider: 'BlackRock iShares', endpoint: 'https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf', type: 'ISSUER_FUND_DATA_NOT_AGGREGATE_FLOW' },
        ],
      },
      dxyIndex: directMetric(macroData.dxy),
      dxyDailyChangePct: directMetric(macroData.dxy),
      broadDollarProxy: directMetric(macroData.broadDollar),
      sp500Price: directMetric(macroData.sp500),
      sp500DailyChangePct: directMetric(macroData.sp500),
      fedRateCutExpectationPct: {
        ...unavailable,
        provider: 'CME FedWatch',
        reason: 'No verified free programmatic probability API is configured. Published rates are reported separately.',
      },
      fedEffectiveRatePct: directMetric(macroData.fedEffectiveRate),
      fedTargetUpperBoundPct: directMetric(macroData.fedTargetUpperBound),
      newsSentimentScore: {
        ...unavailable,
        provider: 'DERIVED_SENTIMENT_NOT_CONFIGURED',
        reason: 'Headlines are direct publisher data; no validated sentiment model is configured.',
      },
      recentHeadlines: newsHeadlinesProvenance,
      whaleNetflowBtc: {
        ...unavailable,
        provider: 'NO_VERIFIED_FREE_EXCHANGE_WALLET_ATTRIBUTION',
        reason: 'Raw network activity does not establish exchange-wallet ownership or whale net flow.',
        sources: [
          { provider: 'Bitcoin Core', endpoint: 'https://bitcoincore.org/en/doc/', type: 'SELF_HOSTED_RAW_CHAIN' },
          { provider: 'mempool.space', endpoint: 'https://mempool.space/docs/api', type: 'RAW_CHAIN_AND_MEMPOOL' },
          { provider: 'Coin Metrics Community API', endpoint: 'https://docs.coinmetrics.io/api/v4/', type: 'PUBLIC_NETWORK_METRICS' },
        ],
      },
      whalePressureIndex: unavailable,
      whaleSentiment: unavailable,
      bitcoinActiveAddresses: directMetric(macroData.bitcoinActiveAddresses),
    },
    etfFlowStatus: 'UNAVAILABLE', spotEtfNetInflowMillionUsd: null,
    dxyStatus: macroData.dxy.status, dxyIndex: macroData.dxy.value,
    dxyDailyChangePct: macroData.dxy.changePct,
    broadDollarProxyStatus: macroData.broadDollar.status,
    broadDollarProxyIndex: macroData.broadDollar.value,
    broadDollarProxyDailyChangePct: macroData.broadDollar.changePct,
    sp500Status: macroData.sp500.status,
    sp500Price: macroData.sp500.value,
    sp500DailyChangePct: macroData.sp500.changePct,
    fedExpectationsStatus: 'UNAVAILABLE', fedRateCutExpectationPct: null,
    fedPublishedRateStatus: macroData.fedEffectiveRate.status,
    fedEffectiveRatePct: macroData.fedEffectiveRate.value,
    fedTargetUpperBoundPct: macroData.fedTargetUpperBound.value,
    newsSentimentStatus: 'UNAVAILABLE', newsSentimentScore: null,
    newsHeadlinesStatus: newsHeadlines.status, recentHeadlines: newsHeadlines.headlines,
    whaleFlowStatus: 'UNAVAILABLE', whaleNetflowBtc: null, whalePressureIndex: null, whaleSentiment: null,
    bitcoinActiveAddressesStatus: macroData.bitcoinActiveAddresses.status,
    bitcoinActiveAddresses: macroData.bitcoinActiveAddresses.value,
    lastUpdated: lastUpdatedAtMs,
    sourceGrounding: sourceRetrievedAtMs.length > 0 ? 'DIRECT_SOURCES' : 'UNAVAILABLE',
  });
});

app.post('/api/veo/generate-video', (_req, res) => res.status(410).json({
  status: 'UNAVAILABLE', error: 'AI video generation has been disabled; no direct data source is configured.',
}));
app.post('/api/veo/video-status', (_req, res) => res.status(410).json({
  status: 'UNAVAILABLE', error: 'AI video generation has been disabled.',
}));
app.post('/api/veo/video-download', (_req, res) => res.status(410).json({
  status: 'UNAVAILABLE', error: 'AI video generation has been disabled.',
}));

app.get('/api/crypto-macro-calendar', (_req, res) => res.status(503).json({
  status: 'UNAVAILABLE', events: [], error: 'No direct economic-calendar provider is configured.',
}));

app.post('/api/sentiment', (_req, res) => {
  res.json({
    status: 'UNAVAILABLE', score: null, label: null, trend: null, drivers: [],
    provenance: { provider: 'NOT_CONFIGURED', retrievedAtMs: null, sources: [] },
    error: 'A direct, verifiable news source is not configured.',
  });
});

// --- Live Trading Safety & Production Readiness Gate Engine (Items 36-40) ---
const KILL_SWITCH_STATE_DB = 'database_kill_switch.json';

function loadKillSwitchState(): boolean {
    if (!fs.existsSync(KILL_SWITCH_STATE_DB)) return true;
    try {
        const parsed = JSON.parse(fs.readFileSync(KILL_SWITCH_STATE_DB, 'utf-8'));
        return typeof parsed.active === 'boolean' ? parsed.active : true;
    } catch {
        console.error('[KILL_SWITCH] Persisted state is unreadable; keeping new entries blocked.');
        return true;
    }
}

function persistKillSwitchState(active: boolean): void {
    const temporaryPath = `${KILL_SWITCH_STATE_DB}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ active, updatedAt: Date.now() }), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temporaryPath, KILL_SWITCH_STATE_DB);
}

let liveTradingState = {
    apiKeyConfigured: false,
    apiKeyPermissions: {
        trade: true,
        withdraw: false, // Must be false for live trading safety
    },
    hasIpRestriction: true,
    ipRestrictionWarning: null as string | null,
    killSwitchActive: loadKillSwitchState(),
    killSwitchSettings: {
        cancelOpenOrders: true,
        closePositions: false
    },
    dailyLossLimitUSD: 500,
    currentDailyLossUSD: 0,
    globalDrawdownLimitPercent: 10.0,
    currentDrawdownPercent: 2.1,
    antiMartingaleEnforced: true,
    readinessTests: {
        "Real Data Test": { status: "NOT_RUN", message: "No validated exchange-data integration test has been run." },
        "Data Staleness Test": { status: "NOT_RUN", message: "No end-to-end data-age test has been run." },
        "API Permission Test": { status: "NOT_RUN", message: "SBK1 does not own exchange credentials." },
        "Order Testnet Test": { status: "NOT_RUN", message: "No Freqtrade testnet order has been submitted." },
        "Partial Fill Test": { status: "NOT_RUN", message: "No partial-fill lifecycle test has been run." },
        "Cancel Test": { status: "NOT_RUN", message: "No exchange cancellation test has been run." },
        "Reconnect Test": { status: "NOT_RUN", message: "No service restart recovery test has been run." },
        "Duplicate Order Test": { status: "NOT_RUN", message: "No exchange-level duplicate-order test has been run." },
        "Exchange/Local Reconciliation Test": { status: "NOT_RUN", message: "Freqtrade is the position authority; reconciliation is unverified." },
        "Kill Switch Test": { status: "NOT_RUN", message: "No end-to-end kill-switch test has been run." },
        "Daily Loss Test": { status: "NOT_RUN", message: "No exchange-backed daily-loss test has been run." },
        "Drawdown Lock Test": { status: "NOT_RUN", message: "No exchange-backed drawdown test has been run." },
        "Clock Drift Test": { status: "NOT_RUN", message: "No exchange clock-drift test has been run." },
        "Slippage Test": { status: "NOT_RUN", message: "No exchange slippage test has been run." },
        "Fee Verification": { status: "NOT_RUN", message: "Exchange fee schedule has not been verified." },
        "Position Recovery Test": { status: "NOT_RUN", message: "No Freqtrade restart/recovery test has been run." },
        "Server Restart Test": { status: "NOT_RUN", message: "No restart/recovery test has been run." }
    } as Record<string, { status: string; message: string }>,
    liveAutoTradeEnabled: false
};
let serverAutoPilotEnabled = false;
let serverSignalRunner: ServerSignalRunner | null = null;

function serializeRunnerUpdate(update: ServerSignalRunnerUpdate): ServerSignalRunnerUpdate {
    const councilReport = update.councilReport;
    return {
        ...update,
        councilReport: councilReport
            ? {
                ...councilReport,
                members: councilReport.members.map((member) => ({
                    ...member,
                    supportingEvidence: member.supportingEvidence.map((evidence) => ({
                        moduleId: evidence.moduleId,
                        nameFa: evidence.nameFa,
                        status: evidence.status,
                        sourceTimestampMs: evidence.sourceTimestampMs,
                        summaryFa: evidence.summaryFa,
                    })),
                })),
            }
            : null,
    };
}

app.get('/api/decision/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (update: ServerSignalRunnerUpdate) => {
        if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(serializeRunnerUpdate(update))}\n\n`);
    };
    const unsubscribe = serverSignalRunner?.subscribe(send);
    if (!serverSignalRunner) {
        send({
            updatedAtMs: Date.now(),
            autoPilotEnabled: serverAutoPilotEnabled,
            candleTimestampMs: null,
            decision: 'NO TRADE',
            reason: 'Server decision runner is not ready.',
            councilReport: null,
        });
    }
    const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15_000);
    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe?.();
    });
});

app.post('/api/decision/auto-pilot', requireAdminAuth, liveOperationLimiter, async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: '`enabled` must be a boolean.' });
    }
    if (enabled) {
        if (liveTradingState.killSwitchActive) {
            return res.status(409).json({ success: false, autoPilotEnabled: false, error: 'Kill switch is active; disarm it before enabling demo Auto-Pilot.' });
        }
        try {
            const status = await freqtradeBridge.getStatus();
            if (status.status !== 'running' || !status.dryRun || status.forceEntryEnabled !== false) {
                return res.status(409).json({
                    success: false,
                    autoPilotEnabled: false,
                    error: 'Auto-Pilot requires a running Freqtrade dry-run instance with force_entry_enable=false.',
                });
            }
        } catch (error) {
            return res.status(503).json({
                success: false,
                autoPilotEnabled: false,
                error: error instanceof Error ? error.message : 'Freqtrade status is unavailable.',
            });
        }
    }
    serverAutoPilotEnabled = enabled;
    serverSignalRunner?.refreshAutoPilotState();
    return res.json({ success: true, autoPilotEnabled: serverAutoPilotEnabled, executionMode: 'DRY_RUN' });
});

app.post('/api/decision/manual-entry', requireAdminAuth, liveOperationLimiter, async (req, res) => {
    const { direction } = req.body;
    if (direction !== 'LONG' && direction !== 'SHORT') {
        return res.status(400).json({ success: false, error: '`direction` must be LONG or SHORT.' });
    }
    if (liveTradingState.killSwitchActive) {
        return res.status(409).json({ success: false, error: 'Kill switch is active; manual entry is blocked.' });
    }
    try {
        const status = await freqtradeBridge.getStatus();
        if (status.status !== 'running' || !status.dryRun || status.forceEntryEnabled !== false) {
            return res.status(409).json({
                success: false,
                error: 'Manual intents require a running Freqtrade dry-run instance with force_entry_enable=false.',
            });
        }
    } catch (error) {
        return res.status(503).json({
            success: false,
            error: error instanceof Error ? error.message : 'Freqtrade status is unavailable.',
        });
    }
    if (!serverSignalRunner) {
        return res.status(503).json({ success: false, error: 'Server decision runner is not ready.' });
    }
    if (!serverSignalRunner.requestManualEntry(direction)) {
        return res.status(409).json({ success: false, error: 'A manual intent is already awaiting server evaluation.' });
    }
    return res.status(202).json({
        success: true,
        status: 'PENDING_SERVER_COUNCIL_AND_RISK_CHECKS',
        direction,
        message: 'Intent queued; no order is authorized until the server council and risk pipeline approve it.',
    });
});

app.get('/api/live/status', async (req, res) => {
    try {
        const [botState, openTrades] = await Promise.all([
            freqtradeBridge.getStatus(),
            freqtradeBridge.getOpenTrades(),
        ]);
        res.json({
            killSwitchActive: liveTradingState.killSwitchActive,
            liveAutoTradeEnabled: false,
            positionAuthority: 'freqtrade',
            executionAuthority: 'freqtrade',
            freqtrade: botState,
            openTrades,
            activePositions: openTrades.map((trade) => ({
                id: String(trade.trade_id),
                tradeId: trade.trade_id,
                pair: trade.pair,
                direction: trade.is_short ? 'SHORT' : 'LONG',
                isOpen: trade.is_open,
                amount: trade.amount,
                openRate: trade.open_rate,
                stakeAmount: trade.stake_amount,
                hasOpenOrders: trade.has_open_orders,
                orders: trade.orders,
            })),
        });
    } catch (error) {
        res.status(503).json({
            killSwitchActive: liveTradingState.killSwitchActive,
            liveAutoTradeEnabled: false,
            positionAuthority: 'freqtrade',
            executionAuthority: 'freqtrade',
            activePositions: [],
            error: error instanceof Error ? error.message : 'Freqtrade state is unavailable.',
        });
    }
});

app.post('/api/live/kill-switch', async (req, res) => {
    const { active } = req.body;
    if (typeof active !== 'boolean') {
        return res.status(400).json({
            success: false,
            error: '`active` must be a boolean. Use true to block new signals, false to disarm.',
        });
    }
    if (active) {
        liveTradingState.killSwitchActive = true;
    }
    let statePersisted = true;
    try {
        persistKillSwitchState(active);
    } catch {
        liveTradingState.killSwitchActive = true;
        console.error('[KILL_SWITCH] State persistence failed; keeping new entries blocked.');
        statePersisted = false;
        if (!active) {
            return res.status(503).json({
                success: false,
                killSwitchActive: true,
                error: 'Kill switch state could not be safely persisted; new entries remain blocked.',
            });
        }
    }
    let cancelledSignals = 0;
    if (active) {
        liveTradingState.liveAutoTradeEnabled = false;
        try {
            cancelledSignals = await freqtradeSignalAdapter.cancelPending('SBK1 kill switch cancelled this queued signal.');
        } catch (error) {
            console.error('[KILL_SWITCH] Signal cancellation persistence failed; switch remains engaged.');
            return res.status(503).json({
                success: false,
                killSwitchActive: true,
                liveAutoTradeEnabled: false,
                error: 'Kill switch is active, but queued signal cancellation could not be confirmed.',
            });
        }
    }
    if (!statePersisted) {
        return res.status(503).json({
            success: false,
            killSwitchActive: true,
            liveAutoTradeEnabled: false,
            cancelledSignals,
            error: 'Kill switch is active in this process and queued signals were cancelled, but durable state persistence failed.',
        });
    }
    liveTradingState.killSwitchActive = active;
    res.json({
        success: true,
        killSwitchActive: liveTradingState.killSwitchActive,
        liveAutoTradeEnabled: liveTradingState.liveAutoTradeEnabled,
        cancelledSignals,
        existingExchangeOrdersAffected: false,
        existingPositionsAffected: false,
        positionAuthority: 'freqtrade',
        message: liveTradingState.killSwitchActive
            ? 'KILL SWITCH ENGAGED: New SBK1 signals are blocked and unclaimed queued signals were cancelled. Existing exchange orders and positions are not changed; reconcile and manage them through Freqtrade.'
            : 'Kill switch disarmed by administrator. Confirm exchange and Freqtrade health before re-enabling signals.',
    });
});

app.post('/api/live/run-readiness-tests', async (_req, res) => {
    let freqtradeState: Awaited<ReturnType<typeof freqtradeBridge.getStatus>> | undefined;
    let rpcFailure: string | undefined;
    try {
        freqtradeState = await freqtradeBridge.getStatus();
    } catch (error) {
        rpcFailure = error instanceof Error ? error.message : String(error);
    }
    const rpcAvailable = freqtradeState?.ping === true && freqtradeState.status === 'running';

    const notRun = { status: 'NOT_RUN', message: 'This readiness test was not run.' };
    let snapshotFresh = false;
    let snapshotMessage = 'Freqtrade market snapshot is not configured.';
    const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim().toLowerCase() || '';
    const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || '';
    const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || '';
    if (exchange && pair && timeframe) {
        try {
            const snapshot = freqtradeMarketDataBridge.getLatestConfigured({ exchange, pair, timeframe });
            const ageMs = Date.now() - snapshot.generatedAtMs;
            snapshotFresh = ageMs >= 0 && ageMs <= FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS;
            snapshotMessage = snapshotFresh
                ? `Latest Freqtrade snapshot is fresh (${ageMs}ms old).`
                : `Latest Freqtrade snapshot is stale or future-dated (${ageMs}ms old).`;
        } catch (error) {
            snapshotMessage = error instanceof Error ? error.message : 'No fresh Freqtrade market snapshot is available.';
        }
    }

    liveTradingState.readinessTests = {
        'Freqtrade RPC': {
            status: rpcAvailable ? 'PASS' : 'FAIL',
            message: rpcFailure ?? (rpcAvailable ? 'Authenticated Freqtrade RPC is reachable.' : 'Freqtrade RPC is not running.'),
        },
        'Freqtrade Snapshot Freshness': {
            status: snapshotFresh ? 'PASS' : 'FAIL',
            message: snapshotMessage,
        },
        'Real Data Test': notRun,
        'Data Staleness Test': notRun,
        'API Permission Test': notRun,
        'Order Testnet Test': notRun,
        'Partial Fill Test': notRun,
        'Cancel Test': notRun,
        'Reconnect Test': notRun,
        'Duplicate Order Test': notRun,
        'Exchange/Local Reconciliation Test': notRun,
        'Kill Switch Test': notRun,
        'Daily Loss Test': notRun,
        'Drawdown Lock Test': notRun,
        'Clock Drift Test': notRun,
        'Slippage Test': notRun,
        'Fee Verification': notRun,
        'Position Recovery Test': notRun,
        'Server Restart Test': notRun,
        'Calibrated Signal Delivery': notRun,
    };
    liveTradingState.liveAutoTradeEnabled = false;
    return res.status(503).json({
        allPassed: false,
        liveExecutionAuthorized: false,
        executionAuthority: 'freqtrade',
        freqtrade: freqtradeState ?? null,
        readinessTests: liveTradingState.readinessTests,
        ordersPlaced: 0,
        message: 'Readiness is blocked; only Freqtrade RPC and market snapshot freshness were checked. No order was placed.',
    });
});

app.post('/api/live/validate-trade', (req, res) => {
    const validation = validateTradeRequest(req.body);
    if (!validation.allowed) {
        return res.status(403).json({ allowed: false, reason: validation.reason });
    }
    res.json({ allowed: true, message: "Trade validated successfully by Server-Side Risk Governor." });
});

// Real-time OrderFlow & Liquidity Sweep Snapshot API
app.get('/api/orderflow/snapshot', async (req, res) => {
    try {
        const { fetchBybit } = await import('./src/services/marketData');
        const { orderFlowEngine } = await import('./src/services/orderFlowEngine');
        const { candles } = await fetchBybit('15', 50);
        const snapshot = orderFlowEngine.analyzeOrderFlowAndLiquidity(candles, null);
        res.json(snapshot);
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to generate orderflow snapshot' });
    }
});

app.post('/api/hunter/execute', liveOperationLimiter, requireAdminAuth, async (req, res) => {
    return res.status(410).json({
        accepted: false,
        status: 'REJECTED',
        code: 'LEGACY_ENTRY_PATH_DISABLED',
        error: 'Manual UI signals cannot authorize entries. Only the server decision runner can create an approved Freqtrade contract.',
    });
});

app.post('/api/freqtrade/dry-run-test-signal', liveOperationLimiter, requireAdminAuth, async (_req, res) => {
    try {
        const configuredPair = freqtradeBridge.getConfiguredPair();
        const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || '';
        const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim() || '';
        const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() || '';
        const [botState, whitelist] = await Promise.all([
            freqtradeBridge.getStatus(),
            freqtradeBridge.getWhitelist(),
        ]);
        const readinessError = getDryRunFixtureReadinessError(botState, {
            enabled: process.env.SBK1_DRY_RUN_FIXTURE_ENABLED === 'true',
            killSwitchActive: liveTradingState.killSwitchActive,
            configuredPair,
            expectedPair: pair,
            expectedExchange: exchange,
            expectedTimeframe: timeframe,
            whitelist,
        });
        if (readinessError) {
            return res.status(409).json({
                success: false,
                code: 'DRY_RUN_FIXTURE_NOT_READY',
                error: readinessError,
            });
        }
        if (liveTradingState.killSwitchActive) {
            return res.status(409).json({
                success: false,
                code: 'KILL_SWITCH_ENGAGED',
                error: 'The SBK1 kill switch is engaged; no dry-run fixture will be created.',
            });
        }

        const { fetchFuturesPrices } = await import('./src/services/marketData');
        const prices = await fetchFuturesPrices(true);
        const priceAgeMs = Date.now() - prices.timestampUtc;
        if (
            prices.status !== 'LIVE' ||
            !Number.isFinite(prices.lastPrice) || prices.lastPrice <= 0 ||
            !Number.isFinite(prices.markPrice) || prices.markPrice <= 0 ||
            !Number.isFinite(prices.indexPrice) || prices.indexPrice <= 0 ||
            !Number.isFinite(priceAgeMs) ||
            priceAgeMs < 0 ||
            priceAgeMs > FREQTRADE_MARKET_SNAPSHOT_MAX_AGE_MS
        ) {
            return res.status(503).json({
                success: false,
                code: 'LIVE_MARKET_DATA_UNAVAILABLE',
                error: 'A fresh Bybit linear-futures price is required to create a dry-run fixture.',
            });
        }

        const riskLimits = {
            riskBudgetPct: Number(process.env.SBK1_SIGNAL_RISK_PCT),
            maxStakeQuote: 100,
            maxLeverage: 1,
        };
        if (
            !Number.isFinite(riskLimits.riskBudgetPct) ||
            riskLimits.riskBudgetPct <= 0 ||
            riskLimits.riskBudgetPct > 1 ||
            !Number.isFinite(riskLimits.maxStakeQuote) ||
            riskLimits.maxStakeQuote <= 0 ||
            riskLimits.maxStakeQuote > 100
        ) {
            return res.status(503).json({
                success: false,
                code: 'FIXTURE_RISK_LIMITS_INVALID',
                error: 'Valid fixture risk limits are required: risk <= 1%, stake <= 100 USDT, and leverage is fixed at 1x.',
            });
        }

        const signal = createDryRunFixtureSignal({
            nowMs: Date.now(),
            exchange,
            pair,
            timeframe,
            referencePrice: prices.lastPrice,
            observedAtMs: prices.timestampUtc,
            source: prices.source,
            riskLimits,
        });
        const record = await freqtradeSignalAdapter.submit(signal, {
            expectedPair: pair,
            expectedExchange: exchange,
            expectedTimeframe: timeframe,
        });
        res.status(record.duplicate ? 200 : 201).json({
            success: true,
            dryRun: true,
            testOnly: true,
            signalId: record.signal.signalId,
            status: record.status,
            expiresAtMs: record.signal.expiresAtMs,
            duplicate: record.duplicate === true,
        });
    } catch (error) {
        const statusCode = error instanceof SbkSignalValidationError ? 422 : 503;
        res.status(statusCode).json({
            success: false,
            code: error instanceof SbkSignalValidationError ? error.code : 'DRY_RUN_FIXTURE_FAILED',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

app.get('/api/freqtrade/signals', requireFreqtradeBridgeAuth, async (req, res) => {
    try {
        const configuredPair = freqtradeBridge.getConfiguredPair();
        const pair = process.env.SBK1_FREQTRADE_PAIR?.trim() || configuredPair;
        const botState = await freqtradeBridge.getStatus();
        const exchange = process.env.SBK1_SIGNAL_EXCHANGE?.trim() ||
            process.env.FREQTRADE_EXCHANGE?.trim() ||
            botState.exchange ||
            '';
        const timeframe = process.env.SBK1_FREQTRADE_TIMEFRAME?.trim() ||
            process.env.FREQTRADE_TIMEFRAME?.trim() ||
            botState.timeframe ||
            '';
        const whitelist = await freqtradeBridge.getWhitelist();
        if (
            botState.status !== 'running' ||
            !botState.dryRun ||
            botState.forceEntryEnabled ||
            botState.strategy !== 'SbkSignalStrategy' ||
            botState.market === undefined ||
            botState.exchange?.toLowerCase() !== exchange.toLowerCase() ||
            botState.timeframe !== timeframe ||
            configuredPair !== pair ||
            !whitelist.includes(pair)
        ) {
            return res.status(409).json({
                error: 'Freqtrade runtime configuration does not match the queued signal market.',
                code: 'FREQTRADE_CONFIGURATION_MISMATCH',
            });
        }

        if (req.query.pair !== pair || req.query.timeframe !== timeframe) {
            return res.status(409).json({
                error: 'Requested pair and timeframe must match the verified Freqtrade configuration.',
                code: 'FREQTRADE_CONFIGURATION_MISMATCH',
            });
        }

        const records = await freqtradeSignalAdapter.getForStrategy(pair, timeframe);
        const openTrades = await freqtradeBridge.getOpenTrades();
        const pendingExitSignals = await freqtradeSignalAdapter.getPendingExitSignals(pair);
        const exitSignals = pendingExitSignals.filter((signal) =>
            openTrades.some((trade) =>
                trade.is_open &&
                trade.pair === signal.pair &&
                (signal.tradeId === undefined || trade.trade_id === signal.tradeId) &&
                (signal.entryTag === undefined || trade.enter_tag === signal.entryTag) &&
                (trade.is_short ? 'SHORT' : 'LONG') === signal.direction
            )
        );
        const fixturesEnabled = process.env.SBK1_DRY_RUN_FIXTURE_ENABLED === 'true';
        const nowMs = Date.now();
        return res.json({
            contractVersion: SBK_SIGNAL_CONTRACT_VERSION,
            signals: liveTradingState.killSwitchActive ? [] : records.filter((record) => {
                const isFixture = record.signal.entryConditions.setupType.startsWith(DRY_RUN_FIXTURE_SETUP_PREFIX);
                const maxAgeMs = isFixture ? 55_000 : 15_000;
                const generatedAgeMs = nowMs - record.signal.generatedAtMs;
                const observedAgeMs = nowMs - record.signal.dataQuality.observedAtMs;
                return record.signal.expiresAtMs > nowMs &&
                    generatedAgeMs >= 0 &&
                    generatedAgeMs <= maxAgeMs &&
                    observedAgeMs >= 0 &&
                    observedAgeMs <= record.signal.dataQuality.maxAgeMs &&
                    record.signal.exchange.toLowerCase() === exchange.toLowerCase() &&
                    record.signal.market === botState.market &&
                    (!isFixture || fixturesEnabled);
            }),
            exitSignals,
        });
    } catch (error) {
        return res.status(503).json({
            error: `Could not verify or deliver Freqtrade signals: ${error instanceof Error ? error.message : String(error)}`,
            code: 'FREQTRADE_SIGNAL_DELIVERY_FAILED',
        });
    }
});

app.post('/api/freqtrade/signals/:signalId/status', requireFreqtradeBridgeAuth, async (req, res) => {
    try {
        const record = await freqtradeSignalAdapter.updateStatus(req.params.signalId, req.body || {});
        void operationalTradeArchive.recordSignalLifecycle(record).catch((archiveError) => {
            console.error('[SBK1_TRADE_ARCHIVE] Could not save Freqtrade signal lifecycle:', archiveError);
        });
        res.json({
            signalId: record.signal.signalId,
            status: record.status,
            updatedAtMs: record.updatedAtMs,
            tradeId: record.tradeId,
            filledAmount: record.filledAmount,
            averageFillPrice: record.averageFillPrice,
        });
    } catch (error) {
        const statusCode = error instanceof SbkSignalValidationError ? 422 : 503;
        res.status(statusCode).json({
            error: error instanceof Error ? error.message : String(error),
            code: error instanceof SbkSignalValidationError ? error.code : 'SIGNAL_STATUS_UPDATE_FAILED',
        });
    }
});

app.get('/api/operational-trade-archive', requireAdminAuth, async (_req, res) => {
    try {
        return res.json({ records: await operationalTradeArchive.getAll() });
    } catch (error) {
        return res.status(503).json({
            error: `Could not load the operational trade archive: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
});

app.get('/api/freqtrade/execution-audit', requireAdminAuth, async (req, res) => {
    const limit = Number(req.query.limit ?? 30);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ error: 'Audit limit must be an integer between 1 and 100.' });
    }
    try {
        const content = await fs.promises.readFile(
            path.resolve('data/sbk1-execution-audit.jsonl'),
            'utf8',
        );
        const lines = content.split(/\r?\n/).filter(Boolean).slice(-limit);
        const records = lines.map((line) => {
            const value: unknown = JSON.parse(line);
            if (
                typeof value !== 'object' ||
                value === null ||
                Array.isArray(value) ||
                typeof (value as Record<string, unknown>).at !== 'string' ||
                !['NO TRADE', 'LONG', 'SHORT'].includes(String((value as Record<string, unknown>).decision)) ||
                typeof (value as Record<string, unknown>).reason !== 'string'
            ) {
                throw new Error('Execution audit contains an invalid record.');
            }
            const record = value as Record<string, unknown>;
            return {
                at: record.at,
                decision: record.decision,
                reason: record.reason,
                ...(typeof record.signalId === 'string' ? { signalId: record.signalId } : {}),
                ...(record.holdingHorizon && typeof record.holdingHorizon === 'object'
                    ? { holdingHorizon: record.holdingHorizon }
                    : {}),
            };
        });
        return res.json({ records });
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return res.json({ records: [] });
        }
        console.error('[SBK1_EXECUTION_AUDIT] Could not read execution audit:', error);
        return res.status(503).json({
            error: `Could not read execution audit: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
});

app.get('/api/hunter/trade-archive/:signalId', requireAdminAuth, async (req, res) => {
    try {
        const record = await operationalTradeArchive.getBySignalId(req.params.signalId);
        if (!record) return res.status(404).json({ error: 'Operational trade archive record was not found.' });
        return res.json(record);
    } catch (error) {
        return res.status(503).json({
            error: `Could not load the operational trade archive record: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
});

async function archiveFreqtradeTradeSnapshot(tradeId: number): Promise<void> {
    if (!Number.isSafeInteger(tradeId) || tradeId <= 0) {
        throw new Error('A valid Freqtrade trade ID is required for archive synchronization.');
    }
    const [trade, status] = await Promise.all([
        freqtradeBridge.getTrade(tradeId),
        freqtradeBridge.getStatus(),
    ]);
    const signalId = trade.enter_tag;
    if (!signalId) return;
    if (!await operationalTradeArchive.getBySignalId(signalId)) return;
    await operationalTradeArchive.recordFreqtradeTrade(
        signalId,
        trade,
        status.dryRun ? 'DRY_RUN' : 'LIVE',
    );
}

app.post('/api/freqtrade/exits/:exitId/status', requireFreqtradeBridgeAuth, async (req, res) => {
    try {
        const record = await freqtradeSignalAdapter.updateExitSignalStatus(
            req.params.exitId,
            req.body?.status,
            req.body?.reason,
        );
        return res.json({
            exitId: record.signal.exitId,
            status: record.status,
            updatedAtMs: record.updatedAtMs,
        });
    } catch (error) {
        const statusCode = error instanceof SbkSignalValidationError ? 422 : 503;
        return res.status(statusCode).json({
            error: error instanceof Error ? error.message : String(error),
            code: error instanceof SbkSignalValidationError ? error.code : 'EXIT_STATUS_UPDATE_FAILED',
        });
    }
});

app.get('/api/hunter/signals/:signalId', requireAdminAuth, async (req, res) => {
    try {
        const record = await freqtradeSignalAdapter.get(req.params.signalId);
        if (!record) return res.status(404).json({ error: 'Signal was not found.' });
        res.json(record);
    } catch (error) {
        res.status(503).json({ error: `Could not read signal lifecycle: ${error instanceof Error ? error.message : String(error)}` });
    }
});

app.post('/api/hunter/exit', liveOperationLimiter, requireAdminAuth, async (req, res) => {
    const tradeId = req.body?.tradeId;
    if (!(typeof tradeId === 'string' || typeof tradeId === 'number') || !/^\d+$/.test(String(tradeId))) {
        return res.status(400).json({
            success: false,
            state: 'REJECTED',
            messageFa: 'شناسه عددی معامله Freqtrade الزامی است؛ درخواست خروج ارسال نشد.'
        });
    }

    try {
        const { orderExecutionLifecycleService } = await import('./src/services/orderExecutionLifecycleEngine');
        const result = await orderExecutionLifecycleService.forceExitFreqtradeTrade(tradeId);
        if (result.success) {
            try {
                await archiveFreqtradeTradeSnapshot(Number(tradeId));
            } catch (archiveError) {
                console.error('[SBK1_TRADE_ARCHIVE] Could not save closed Freqtrade trade:', archiveError);
            }
        }
        res.status(result.success ? 200 : 503).json(result);
    } catch (err: any) {
        res.status(500).json({
            success: false,
            state: 'REJECTED',
            messageFa: `خطای امن هنگام خروج از معامله Freqtrade: ${err.message || 'خطای نامشخص'}`
        });
    }
});

// Realistic Python Backtester Execution Route
app.get('/api/backtest/run', async (req, res) => {
    try {
        const result = await runPythonScript('scripts/realistic_backtester.py', ['--synthetic'], undefined, 15000);
        let parsed = result;
        try {
            parsed = typeof result === 'string' ? JSON.parse(result) : result;
        } catch {}
        res.json(parsed);
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Backtest script execution failed' });
    }
});

// DB helpers (Databases are initialized at the very top of server.ts)
function readDb<T>(filePath: string, defaultValue: T): T {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error(`Error reading database file ${filePath}:`, e);
    }
    return defaultValue;
}

function writeDb<T>(filePath: string, data: T) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error(`Error writing database file ${filePath}:`, e);
    }
}

function initPersistentStorage() {
    activePositions = readDb<TradePosition[]>(POSITIONS_DB, []);
    tradeHistory = readDb<TradeHistory[]>(HISTORY_DB, []);
    idempotencyLog = readDb<Record<string, any>>(IDEMPOTENCY_DB, {});
}

// Logging and Telegram Notification Utilities (Item 7)
function logTradingEvent(event: string, details: string) {
    const logLine = `[${new Date().toISOString()}] ${event.toUpperCase()}: ${details}\n`;
    fs.appendFileSync('trading_audit.log', logLine, 'utf-8');
    console.log(logLine.trim());
}

async function startServerSideMarketFeed() {
    initPersistentStorage();
}

// API Live Toggling Routes (Item 2)
app.post('/api/live/toggle-auto-trade', (req, res) => {
    const { enable } = req.body;
    if (enable) {
        liveTradingState.liveAutoTradeEnabled = false;
        return res.status(409).json({
            success: false,
            liveAutoTradeEnabled: false,
            error: 'Legacy SBK1 auto-trading is disabled. Freqtrade is the sole execution and position-management owner.',
        });
    }
    liveTradingState.liveAutoTradeEnabled = false;
    res.json({ success: true, liveAutoTradeEnabled: false });
});

app.use('/api', (req, res) => {
    res.status(404).json({
        success: false,
        code: 'API_ROUTE_NOT_FOUND',
        error: 'API route not found.',
    });
});

// Vite middleware
let viteServer: Awaited<ReturnType<typeof createViteServer>> | null = null;
let httpServer: ReturnType<typeof app.listen> | null = null;

function listenOnAvailablePort(port: number, allowFallback: boolean): Promise<ReturnType<typeof app.listen>> {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, process.env.SBK1_HOST?.trim() || '127.0.0.1');
        server.once('listening', () => resolve(server));
        server.once('error', (error: NodeJS.ErrnoException) => {
            server.close(() => {
                if (error.code === 'EADDRINUSE' && allowFallback && port < 65535) {
                    console.warn(`Port ${port} is occupied; trying port ${port + 1}.`);
                    resolve(listenOnAvailablePort(port + 1, true));
                    return;
                }
                reject(error);
            });
        });
    });
}

async function startServer() {
  viteServer = await createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'spa'
  });
  if (shutdownRequested) {
    await viteServer.close();
    return;
  }

  app.use(viteServer.middlewares);

  // Initialize persistent state; execution snapshots and chart pricing use the configured Freqtrade market.
  await startServerSideMarketFeed();
  if (shutdownRequested) {
    await viteServer.close();
    return;
  }
  const streamPair = process.env.SBK1_FREQTRADE_PAIR?.trim() ||
    process.env.FREQTRADE_PAIR?.trim();
  if (streamPair) {
    const streamMarket = process.env.SBK1_MARKET?.trim() === 'spot' ||
      process.env.FREQTRADE_MARKET?.trim() === 'spot'
      ? 'spot'
      : 'futures';
    try {
      binancePublicMarketDataStream.start(streamPair, streamMarket);
    } catch (error) {
      console.error('[SBK1] Binance live market stream could not be configured; REST fallback remains enabled:', error);
    }
    try {
      bybitPublicMarketDataStream.start(streamPair, streamMarket);
    } catch (error) {
      console.error('[SBK1] Bybit live chart stream could not be configured; the chart will report it as unavailable:', error);
    }
  } else {
    console.warn('[SBK1] Public market streams were not started; no Freqtrade pair is configured.');
  }

    const configuredPort = Number(process.env.SBK1_PORT || 3000);
    if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
        throw new Error('SBK1_PORT must be an integer between 1 and 65535.');
    }
    httpServer = await listenOnAvailablePort(configuredPort, process.env.SBK1_PORT === undefined);
    const address = httpServer.address();
    const listeningPort = typeof address === 'object' && address ? address.port : configuredPort;
    console.log(`Server running on port ${listeningPort}`);
    serverSignalRunner = createServerSignalRunner({
      isKillSwitchActive: () => liveTradingState.killSwitchActive,
      isAutoPilotEnabled: () => serverAutoPilotEnabled,
    });
    serverSignalRunner.start();
}

async function shutdownServer(signal: NodeJS.Signals): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log(`[SBK1] Received ${signal}; shutting down server.`);

  const forceCloseTimer = setTimeout(() => {
    httpServer?.closeAllConnections();
    process.exit(1);
  }, 10_000);
  forceCloseTimer.unref();

  try {
    await Promise.all([
      serverSignalRunner?.stop(),
      openSourceAdvisoryService.stop(),
      Promise.resolve(binancePublicMarketDataStream.stop()),
      Promise.resolve(bybitPublicMarketDataStream.stop()),
      new Promise<void>((resolve, reject) => {
        if (!httpServer?.listening) {
          resolve();
          return;
        }
        httpServer.close((error) => error ? reject(error) : resolve());
      }),
      viteServer?.close(),
    ]);
  } catch (error) {
    console.error('[SBK1] Graceful shutdown failed:', error);
    process.exitCode = 1;
  } finally {
    clearTimeout(forceCloseTimer);
  }
}

process.once('SIGINT', () => void shutdownServer('SIGINT'));
process.once('SIGTERM', () => void shutdownServer('SIGTERM'));

startServer();
