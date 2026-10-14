import React, { useCallback, useEffect, useState } from 'react';
import type { FreqtradeTrade } from '../services/freqtradeBridge';
import type { ExecutionMode } from '../types/trading';
import { getExecutionSettings } from '../services/executionMode';

interface DashboardRecord {
    signalId: string;
    status: string;
    updatedAtMs: number;
    reason?: string;
    tradeId?: number;
    filledAmount?: number;
    averageFillPrice?: number;
    testOnlyFixture: boolean;
    lifecycle: Array<{
        status: string;
        observedAtMs: number;
        source: string;
        reason?: string;
        tradeId?: number;
        filledAmount?: number;
        averageFillPrice?: number;
    }>;
}

interface ExecutionDashboard {
    selectedProfile?: 'DEMO' | 'LIVE';
    selectedFreqtradeMode?: ExecutionMode;
    freqtradeMode?: 'DEMO' | 'TESTNET' | 'LIVE' | 'UNKNOWN';
    modeMatchesSelection?: boolean;
    rpc?: { status: string; lastCheckedAtMs?: number };
    exchange?: { status: string; name?: string | null; market?: string | null; pair?: string | null; timeframe?: string | null };
    freqtrade?: {
        status: string;
        dryRun: boolean;
        demoTrading: boolean;
        forceEntryEnabled: boolean;
        strategy: string | null;
        openTradesCount: number;
        stakeAmount?: number | string | null;
        dryRunWallet?: number | null;
        maxOpenTrades?: number | null;
        marginMode?: string | null;
    };
    balance?: { kind: string; equity: number | null; available: number | null; currency: string | null };
    openTrades?: FreqtradeTrade[];
    orderCount?: number;
    filledOrderCount?: number;
    market?: {
        status: string;
        source?: string;
        pair?: string;
        timeframe?: string;
        lastPrice?: number | null;
        observedAtMs?: number | null;
        snapshotAtMs?: number;
        ageMs?: number;
        error?: string;
    };
    analysis?: { status: string; lastDecisionAtMs: number | null; reason: string };
    signals?: {
        status: string;
        queuedCount: number | null;
        rejectedCount: number | null;
        records: DashboardRecord[];
        error?: string;
    };
    killSwitchActive?: boolean;
    services?: { sbk1: string; freqtrade: string };
    live?: { status: string; activationAllowed: boolean; blockers: string[] };
    error?: string;
}

interface Props {
    onModeSelected: (mode: ExecutionMode, isLocalSelection: boolean) => void;
    analysisStatus: string;
    lastAnalysisAtMs: number | null;
}

function formatTimestamp(timestamp: number | null | undefined): string {
    return typeof timestamp === 'number' ? new Date(timestamp).toLocaleString() : 'نامشخص';
}

const ExecutionGovernorDashboard: React.FC<Props> = ({ onModeSelected, analysisStatus, lastAnalysisAtMs }) => {
    const [dashboard, setDashboard] = useState<ExecutionDashboard | null>(null);
    const [activeView, setActiveView] = useState<'DEMO' | 'LIVE'>('DEMO');
    const [loading, setLoading] = useState(false);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const getAdminToken = () => localStorage.getItem('admin_token');

    const refresh = useCallback(async () => {
        const token = getAdminToken();
        if (!token) {
            setLoadError('برای مشاهدهٔ وضعیت خصوصی Freqtrade، توکن ادمین سمت کاربر موجود نیست.');
            setDashboard(null);
            return;
        }

        try {
            const settings = await getExecutionSettings();
            const response = await fetch('/api/execution/dashboard', {
                headers: { 'x-admin-token': token },
                cache: 'no-store',
            });
            const payload = await response.json() as ExecutionDashboard;
            setDashboard(payload);
            if (!response.ok) {
                throw new Error(payload.error || `HTTP ${response.status}`);
            }
            if (settings.mode !== 'DRY_RUN' || settings.selectedProfile !== 'DEMO') {
                throw new Error('حالت انتخاب‌شده از سرور با پروفایل DEMO تطبیق ندارد.');
            }
            setLoadError(null);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : 'وضعیت سرور قابل دریافت نیست.');
        }
    }, []);

    useEffect(() => {
        onModeSelected('DRY_RUN', false);
        void refresh();
        const interval = window.setInterval(() => void refresh(), 5_000);
        return () => window.clearInterval(interval);
    }, [onModeSelected, refresh]);

    const postAdminAction = async (url: string, body: Record<string, unknown>) => {
        const token = getAdminToken();
        if (!token) throw new Error('توکن ادمین برای این عملیات موجود نیست.');
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
            body: JSON.stringify(body),
        });
        const payload = await response.json() as {
            error?: string;
            blockers?: string[];
            status?: string;
            queued?: boolean;
            cancelledSignals?: number;
            killSwitchActive?: boolean;
        };
        if (!response.ok) {
            const blockers = payload.blockers?.join(' | ');
            throw new Error([payload.error || `HTTP ${response.status}`, blockers].filter(Boolean).join(' — '));
        }
        return payload;
    };

    const updateKillSwitch = async () => {
        const nextActive = dashboard?.killSwitchActive !== true;
        if (!nextActive && !window.confirm('غیرفعال‌کردن Kill Switch فقط صف سیگنال را دوباره باز می‌کند؛ ادامه می‌دهید؟')) return;
        setLoading(true);
        setActionMessage(null);
        try {
            const result = await postAdminAction('/api/live/kill-switch', { active: nextActive });
            setActionMessage(
                result.killSwitchActive
                    ? `Kill Switch فعال شد؛ ${result.cancelledSignals ?? 0} سیگنال صف‌شده لغو شد.`
                    : 'Kill Switch غیرفعال شد؛ مسیرهای مستقل Freqtrade همچنان باید بررسی شوند.',
            );
            await refresh();
        } catch (error) {
            setActionMessage(error instanceof Error ? error.message : 'تغییر Kill Switch ناموفق بود.');
        } finally {
            setLoading(false);
        }
    };

    const enqueueFixture = async () => {
        if (!window.confirm('فقط با تأیید dry_run واقعی Freqtrade، یک سیگنال fixture با قیمت تازه به صف DEMO افزوده می‌شود. ادامه؟')) return;
        setLoading(true);
        setActionMessage(null);
        try {
            const result = await postAdminAction('/api/freqtrade/dry-run-test-signal', {});
            setActionMessage(result.queued ? 'Fixture فقط برای Dry-run به صف افزوده شد.' : 'پاسخی برای ثبت Fixture دریافت نشد.');
            await refresh();
        } catch (error) {
            setActionMessage(error instanceof Error ? error.message : 'ثبت Fixture ناموفق بود.');
            await refresh();
        } finally {
            setLoading(false);
        }
    };

    const requestLiveActivation = async () => {
        if (!window.confirm('این درخواست با پاسخ BLOCKED ثبت می‌شود و هیچ سفارشی ارسال نمی‌کند. ثبت درخواست LIVE؟')) return;
        setLoading(true);
        setActionMessage(null);
        try {
            const result = await postAdminAction('/api/execution/live/activate', { confirmation: 'ACTIVATE_LIVE' });
            setActionMessage(`LIVE ${result.status ?? 'BLOCKED'}؛ هیچ سفارشی ارسال نشد.`);
        } catch (error) {
            setActionMessage(error instanceof Error ? error.message : 'LIVE مسدود ماند.');
            await refresh();
        } finally {
            setLoading(false);
        }
    };

    const freqtrade = dashboard?.freqtrade;
    const canEnqueueFixture = freqtrade?.dryRun === true &&
        freqtrade.demoTrading !== true &&
        freqtrade.forceEntryEnabled === false &&
        freqtrade.openTradesCount === 0 &&
        dashboard?.killSwitchActive === false;

    return (
        <section className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-white" aria-live="polite">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold">پروفایل اجرا و وضعیت Freqtrade</h2>
                    <p className="mt-1 text-xs text-amber-200">
                        حالت انتخاب‌شده: DEMO؛ LIVE مستقل است و تا عبور از گیت سرور BLOCKED می‌ماند.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        aria-pressed={activeView === 'DEMO'}
                        onClick={() => setActiveView('DEMO')}
                        className={`rounded px-3 py-1 text-sm ${activeView === 'DEMO' ? 'bg-cyan-700' : 'bg-slate-700'}`}
                    >
                        DEMO
                    </button>
                    <button
                        type="button"
                        aria-pressed={activeView === 'LIVE'}
                        onClick={() => setActiveView('LIVE')}
                        className={`rounded border border-rose-700 px-3 py-1 text-sm ${activeView === 'LIVE' ? 'bg-rose-900' : 'bg-slate-700'}`}
                    >
                        LIVE · BLOCKED
                    </button>
                    <button type="button" onClick={() => void refresh()} className="rounded bg-slate-700 px-3 py-1 text-sm">
                        تازه‌سازی
                    </button>
                </div>
            </div>

            {loadError && <p role="alert" className="mb-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-sm text-amber-100">{loadError}</p>}
            {actionMessage && <p role="status" className="mb-3 rounded border border-slate-700 bg-slate-950 p-2 text-sm">{actionMessage}</p>}

            {activeView === 'DEMO' ? (
                <>
                    <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded bg-slate-800 p-3">
                            <strong>موتور Freqtrade</strong>
                            <p>{dashboard?.freqtradeMode ?? 'UNKNOWN'} · {dashboard?.modeMatchesSelection === true ? 'مطابق DEMO' : 'عدم تطبیق/تأییدنشده'}</p>
                            <p className="text-xs text-slate-400">dry_run: {freqtrade?.dryRun === true ? 'true' : freqtrade?.dryRun === false ? 'false' : 'نامشخص'}؛ force_entry: {freqtrade?.forceEntryEnabled === false ? 'خاموش' : 'نامشخص/روشن'}</p>
                        </div>
                        <div className="rounded bg-slate-800 p-3">
                            <strong>RPC و صرافی</strong>
                            <p>RPC: {dashboard?.rpc?.status ?? 'UNAVAILABLE'} · صرافی: {dashboard?.exchange?.status ?? 'UNAVAILABLE'}</p>
                            <p className="text-xs text-slate-400">{dashboard?.exchange?.name ?? 'صرافی نامشخص'} · {dashboard?.exchange?.pair ?? 'جفت‌ارز نامشخص'} · {dashboard?.exchange?.timeframe ?? 'تایم‌فریم نامشخص'}</p>
                        </div>
                        <div className="rounded bg-slate-800 p-3">
                            <strong>آخرین دادهٔ Freqtrade</strong>
                            <p>{dashboard?.market?.status ?? 'UNAVAILABLE'}{dashboard?.market?.lastPrice ? ` · ${dashboard.market.lastPrice}` : ''}</p>
                            <p className="text-xs text-slate-400">{dashboard?.market?.observedAtMs ? formatTimestamp(dashboard.market.observedAtMs) : dashboard?.market?.error ?? 'قیمت معتبر موجود نیست.'}</p>
                        </div>
                        <div className="rounded bg-slate-800 p-3">
                            <strong>تحلیل در رابط</strong>
                            <p>{analysisStatus}</p>
                            <p className="text-xs text-slate-400">آخرین به‌روزرسانی تحلیل: {formatTimestamp(lastAnalysisAtMs)} · این تحلیل مجوز سیگنال تولیدی نیست.</p>
                        </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded bg-slate-800 p-3">
                            <strong>موجودی {dashboard?.balance?.kind === 'VIRTUAL' ? 'مجازی Freqtrade' : dashboard?.balance?.kind === 'TESTNET' ? 'آزمایشی صرافی' : dashboard?.balance?.kind === 'EXCHANGE' ? 'واقعی Freqtrade' : 'تأییدنشده'}</strong>
                            <p>{(dashboard?.balance?.kind === 'VIRTUAL' || dashboard?.balance?.kind === 'TESTNET' || dashboard?.balance?.kind === 'EXCHANGE') && typeof dashboard.balance.equity === 'number'
                                ? `${dashboard.balance.equity.toFixed(2)} ${dashboard.balance.currency}`
                                : 'UNAVAILABLE'}</p>
                            <p className="text-xs text-slate-400">آزاد: {(dashboard?.balance?.kind === 'VIRTUAL' || dashboard?.balance?.kind === 'TESTNET' || dashboard?.balance?.kind === 'EXCHANGE') && typeof dashboard.balance.available === 'number'
                                ? `${dashboard.balance.available.toFixed(2)} ${dashboard.balance.currency}`
                                : 'UNAVAILABLE'}</p>
                        </div>
                        <div className="rounded bg-slate-800 p-3">
                            <strong>صف سیگنال</strong>
                            <p>صف‌شده: {dashboard?.signals?.queuedCount ?? 'نامشخص'} · ردشده: {dashboard?.signals?.rejectedCount ?? 'نامشخص'}</p>
                        </div>
                        <div className="rounded bg-slate-800 p-3">
                            <strong>سفارش / Fill / موقعیت</strong>
                            <p>{dashboard?.orderCount ?? 'نامشخص'} / {dashboard?.filledOrderCount ?? 'نامشخص'} / {freqtrade?.openTradesCount ?? 'نامشخص'}</p>
                        </div>
                        <div className="rounded bg-slate-800 p-3">
                            <strong>سرویس‌ها و توقف اضطراری</strong>
                            <p>SBK1: {dashboard?.services?.sbk1 ?? 'UNKNOWN'} · Freqtrade: {dashboard?.services?.freqtrade ?? 'UNKNOWN'}</p>
                            <p className={dashboard?.killSwitchActive === true ? 'text-rose-300' : 'text-amber-200'}>
                                Kill Switch: {dashboard?.killSwitchActive === true ? 'فعال' : dashboard?.killSwitchActive === false ? 'غیرفعال' : 'نامشخص'}
                            </p>
                        </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                        محدودیت Freqtrade: stake ثابت {freqtrade?.stakeAmount ?? 'نامشخص'} · حداکثر موقعیت {freqtrade?.maxOpenTrades ?? 'نامشخص'} · wallet مجازی {freqtrade?.dryRunWallet ?? 'نامشخص'} · margin {freqtrade?.marginMode ?? 'نامشخص'}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={loading || !dashboard} onClick={() => void updateKillSwitch()} className="rounded border border-rose-700 bg-rose-950 px-3 py-2 text-sm disabled:opacity-50">
                            {dashboard?.killSwitchActive === true ? 'غیرفعال‌کردن Kill Switch' : 'فعال‌کردن Kill Switch'}
                        </button>
                        <button type="button" disabled={loading || !canEnqueueFixture} onClick={() => void enqueueFixture()} title="فقط با RPC تأییدشدهٔ Freqtrade dry_run فعال می‌شود." className="rounded border border-cyan-700 bg-cyan-950 px-3 py-2 text-sm disabled:opacity-50">
                            صف Fixture شبیه‌سازی‌شدهٔ Dry-run
                        </button>
                    </div>

                    <div className="mt-4 space-y-2">
                        {(dashboard?.openTrades ?? []).map((trade) => (
                            <article key={trade.trade_id} className="rounded border border-cyan-900 bg-slate-950 p-3 text-xs">
                                <strong>موقعیت {dashboard?.freqtradeMode ?? 'UNKNOWN'} #{trade.trade_id} · {trade.pair} · {trade.is_short ? 'SHORT' : 'LONG'}</strong>
                                <p>مقدار: {trade.amount} · ورود: {trade.open_rate} · وثیقه: {trade.stake_amount}</p>
                                <ul className="mt-1 space-y-1">
                                    {trade.orders.map((order) => (
                                        <li key={order.order_id}>
                                            سفارش {order.ft_order_side} · {order.status} · پرشده {order.filled ?? 0}/{order.amount} · قیمت {order.safe_price}
                                        </li>
                                    ))}
                                </ul>
                            </article>
                        ))}
                        {(dashboard?.signals?.records ?? []).map((record) => (
                            <article key={record.signalId} className="rounded border border-slate-700 bg-slate-950 p-3 text-xs">
                                <strong>{record.testOnlyFixture ? 'FIXTURE / فقط DEMO' : 'سیگنال'} · {record.status}</strong>
                                <span className="ml-2 text-slate-400">{formatTimestamp(record.updatedAtMs)}</span>
                                {record.reason && <p className="mt-1 text-amber-200">{record.reason}</p>}
                                <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-slate-300">
                                    {record.lifecycle.map((event, index) => (
                                        <li key={`${event.observedAtMs}-${index}`}>{event.status} · {formatTimestamp(event.observedAtMs)}</li>
                                    ))}
                                </ol>
                            </article>
                        ))}
                        {dashboard?.signals?.error && <p className="text-xs text-amber-200">چرخه سیگنال در دسترس نیست: {dashboard.signals.error}</p>}
                    </div>
                </>
            ) : (
                <div className="rounded border border-rose-800 bg-rose-950/30 p-4">
                    <h3 className="font-bold text-rose-200">LIVE: BLOCKED — READY نیست</h3>
                    <p className="mt-1 text-sm text-slate-300">انتخاب این نما، پروفایل DEMO یا تنظیمات Freqtrade را تغییر نمی‌دهد. درخواست فعال‌سازی فقط در سرور ثبت و رد می‌شود.</p>
                    <ul className="mt-3 list-disc space-y-1 pr-5 text-sm text-rose-100">
                        {(dashboard?.live?.blockers ?? ['گزارش موانع سرور قابل دریافت نیست.']).map((blocker) => <li key={blocker}>{blocker}</li>)}
                    </ul>
                    <button type="button" disabled={loading || !dashboard} onClick={() => void requestLiveActivation()} className="mt-4 rounded border border-rose-600 bg-rose-900 px-3 py-2 text-sm disabled:opacity-50">
                        ثبت درخواست بررسی LIVE (ارسال سفارش غیرفعال)
                    </button>
                </div>
            )}
        </section>
    );
};

export default ExecutionGovernorDashboard;
