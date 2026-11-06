import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, RefreshCw, Wallet } from 'lucide-react';

type WalletBehaviorLabel =
  | 'INSUFFICIENT_ACTIVITY'
  | 'EXCHANGE_FLOW'
  | 'TRANSFER_NETWORK'
  | 'TRANSFER_ACTIVITY';

type WalletHistorySyncStatus = 'PENDING' | 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
type WalletActivityStatus = 'ACTIVE' | 'INACTIVE';
type WalletActivityType =
  | 'NATIVE_TRANSFER'
  | 'TOKEN_TRANSFER'
  | 'SWAP_PATTERN'
  | 'DEX_ORDER'
  | 'CONTRACT_INTERACTION';

interface WalletProfile {
  address: string;
  chain: 'BTC' | 'ETH' | 'BNB' | 'SOL' | 'XRP';
  related_assets: Array<'BTC' | 'ETH' | 'BNB' | 'SOL' | 'XRP'>;
  activity_status: WalletActivityStatus;
  last_large_activity_at: string;
  analysis_activity_count: number;
  analysis_eligible: boolean;
  last_seen: string;
  window_90d: {
    transfer_count: number;
    transaction_count: number;
    native_volume: number;
    estimated_volume_usd: number;
    exchange_interaction_count: number;
    unique_counterparty_count: number;
    active_days: number;
    history_days_covered: number;
    token_transfer_count: number;
    swap_pattern_count: number;
    dex_order_count: number;
    large_activity_count: number;
    large_transaction_count: number;
    large_native_volume: number;
    large_estimated_volume_usd: number;
  };
  behavior_score: number;
  behavior_label: WalletBehaviorLabel;
  trading_behavior: 'UNOBSERVED' | 'SWAP_PATTERN_OBSERVED';
  history_sync_status: WalletHistorySyncStatus;
  history_source: string | null;
  history_synced_at: string | null;
  history_coverage_from: string | null;
  history_error: string | null;
  known_exchange_address: boolean;
  exchange_names: string[];
  recent_activity: Array<{
    transaction_hash: string;
    timestamp_ms: number;
    role: 'INCOMING' | 'OUTGOING' | 'SELF' | 'PARTICIPANT';
    activity_type: WalletActivityType;
    large_activity: boolean;
    amount_native: number | null;
    token_amount?: number;
    token_symbol?: string;
    token_address?: string;
    counterparty_addresses: string[];
  }>;
}

interface WalletProfilesResponse {
  status: 'LIVE' | 'EMPTY';
  updatedAtMs: number | null;
  totalWallets: number;
  wallets: WalletProfile[];
}

const PAGE_SIZE = 100;

const behaviorLabels: Record<WalletBehaviorLabel, string> = {
  INSUFFICIENT_ACTIVITY: 'دادهٔ ناکافی',
  EXCHANGE_FLOW: 'جریان مرتبط با صرافی',
  TRANSFER_NETWORK: 'شبکهٔ انتقال',
  TRANSFER_ACTIVITY: 'فعالیت انتقالی',
};

const historyStatusLabels: Record<WalletHistorySyncStatus, string> = {
  PENDING: 'تاریخچه در صف دریافت',
  COMPLETE: 'تاریخچهٔ درخواستی دریافت شد',
  PARTIAL: 'تاریخچه ناقص',
  UNAVAILABLE: 'منبع تاریخچه نامتاح',
};

const activityLabels: Record<WalletActivityType, string> = {
  NATIVE_TRANSFER: 'انتقال دارایی بومی',
  TOKEN_TRANSFER: 'انتقال توکن',
  SWAP_PATTERN: 'الگوی احتمالی سواپ',
  DEX_ORDER: 'تعامل سفارش/AMM',
  CONTRACT_INTERACTION: 'تعامل با قرارداد',
};

const activityRoleLabels: Record<WalletProfile['recent_activity'][number]['role'], string> = {
  INCOMING: 'ورودی',
  OUTGOING: 'خروجی',
  SELF: 'درون‌کیف‌پول',
  PARTICIPANT: 'مشارکت',
};
const activityStatusLabels: Record<WalletActivityStatus, string> = {
  ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال (پروفایل نگهداری می‌شود)',
};

function shortAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 9)}…${address.slice(-7)}` : address;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('fa-IR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export const WalletProfilesWidget: React.FC = () => {
  const [snapshot, setSnapshot] = useState<WalletProfilesResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/wallet-profiles?limit=${PAGE_SIZE}&offset=${offset}`, { signal });
      if (!response.ok) throw new Error(`Wallet profile request returned HTTP ${response.status}.`);
      const data = await response.json() as WalletProfilesResponse;
      if (!Array.isArray(data.wallets) || !Number.isSafeInteger(data.totalWallets)) {
        throw new Error('Wallet profile response is malformed.');
      }
      setSnapshot(data);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === 'AbortError') return;
      console.error('[WalletProfilesWidget] Could not load wallet profiles:', loadError);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProfiles(controller.signal);
    const timer = setInterval(() => void loadProfiles(controller.signal), 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [loadProfiles]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil((snapshot?.totalWallets ?? 0) / PAGE_SIZE));

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      <header className="mb-4 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-300">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-100">پروفایل رفتار کیف‌پول‌ها</h3>
            <p className="text-xs text-slate-400">
              {snapshot?.totalWallets ?? 0} آدرس ذخیره‌شده · پنجرهٔ رفتاری ۹۰روزه
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadProfiles()}
          disabled={loading}
          aria-label="به‌روزرسانی پروفایل کیف‌پول‌ها"
          className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-6 text-amber-200/80">
        امتیاز، شاخص فعالیت است نه اعتماد یا پیش‌بینی قیمت. کشف اولیه فقط انتقال‌های بومیِ بزرگ را می‌بیند؛
        تاریخچهٔ آدرس‌های کشف‌شده ممکن است انتقال توکن و الگوی احتمالی swap را هم ثبت کند. الگوی swap
        heuristic است و اثبات معامله نیست.
        {snapshot?.updatedAtMs
          ? ` آخرین به‌روزرسانی: ${new Date(snapshot.updatedAtMs).toLocaleString('fa-IR')}`
          : ''}
      </p>

      {error ? (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          دریافت پروفایل‌ها ناموفق بود: {error}
        </div>
      ) : snapshot?.wallets.length ? (
        <div className="space-y-2">
          {snapshot.wallets.map((profile) => (
            <article
              key={`${profile.chain}:${profile.address}`}
              className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                    {profile.chain}
                  </span>
                  {profile.related_assets.filter((asset) => asset !== profile.chain).map((asset) => (
                    <span key={asset} className="rounded bg-slate-800/70 px-1.5 py-0.5 text-[10px] text-slate-400"
                      title="همان آدرس در شبکهٔ دیگر است؛ مالکیت یکسان تأیید نشده است">
                      {asset} · آدرس همسان
                    </span>
                  ))}
                  <code className="truncate text-xs text-slate-200" title={profile.address}>
                    {shortAddress(profile.address)}
                  </code>
                  {profile.known_exchange_address && profile.exchange_names.map((name) => (
                    <span key={name} className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-200">
                      {name}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
                    {behaviorLabels[profile.behavior_label]}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    profile.analysis_eligible
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                  }`}>
                    {profile.analysis_eligible
                      ? 'واجد شرایط تحلیل رفتاری'
                      : `مرحلهٔ کشف: ${profile.analysis_activity_count}/15 فعالیت بزرگ`}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    profile.activity_status === 'ACTIVE'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-600 bg-slate-800 text-slate-300'
                  }`}>
                    {activityStatusLabels[profile.activity_status]}
                  </span>
                  <span
                    className="text-[10px] text-slate-500"
                    title={profile.history_error ?? profile.history_source ?? undefined}
                  >
                    {historyStatusLabels[profile.history_sync_status]}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    الگوی سواپ: {profile.window_90d.swap_pattern_count}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    آخرین انتقال بزرگ: {new Date(profile.last_large_activity_at).toLocaleDateString('fa-IR')}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                <span>{profile.window_90d.large_transaction_count} تراکنش بزرگ در ۹۰ روز</span>
                <span>{profile.window_90d.large_activity_count} فعالیت بزرگ</span>
                <span>{profile.window_90d.active_days} روز فعال</span>
                <span>{profile.window_90d.unique_counterparty_count} طرف مقابل</span>
                <span>{profile.window_90d.token_transfer_count} انتقال توکن</span>
                <span>{formatUsd(profile.window_90d.large_estimated_volume_usd)} حجم دلاری فعالیت‌های بزرگ</span>
              </div>

              <div className="flex items-center gap-2 lg:justify-end">
                <Activity className="h-4 w-4 text-emerald-400" />
                <span className="text-xs text-slate-400">امتیاز فعالیت</span>
                <strong className="min-w-10 text-right text-sm text-emerald-300">
                  {profile.behavior_score}/100
                </strong>
              </div>
              {profile.recent_activity.length > 0 && (
                <details className="text-xs text-slate-400 lg:col-span-3">
                  <summary className="cursor-pointer select-none">
                    آخرین فعالیت‌های ثبت‌شده ({profile.recent_activity.length})
                  </summary>
                  <ol className="mt-2 grid gap-1 border-r border-slate-700 pr-3">
                    {profile.recent_activity.map((activity, index) => {
                      const amount = activity.amount_native !== null
                        ? `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 8 })
                            .format(activity.amount_native)} ${profile.chain}`
                        : activity.token_amount !== undefined
                          ? `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 8 })
                              .format(activity.token_amount)} ${activity.token_symbol ?? 'توکن'}`
                          : 'مقدار نامشخص';
                      return (
                        <li key={`${activity.transaction_hash}:${activity.activity_type}:${index}`}
                          className="flex flex-wrap gap-x-2 gap-y-1">
                          <time dateTime={new Date(activity.timestamp_ms).toISOString()}>
                            {new Date(activity.timestamp_ms).toLocaleString('fa-IR')}
                          </time>
                          <span>{activityLabels[activity.activity_type]}</span>
                          {activity.large_activity && (
                            <span className="font-semibold text-amber-300">فعالیت بزرگ</span>
                          )}
                          <span>{activityRoleLabels[activity.role]}</span>
                          <span>{amount}</span>
                          <code title={activity.transaction_hash}>
                            {shortAddress(activity.transaction_hash)}
                          </code>
                        </li>
                      );
                    })}
                  </ol>
                </details>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 text-center text-sm text-slate-400">
          {loading ? 'در حال دریافت پروفایل‌ها…' : 'هنوز آدرسی در انتقال‌های واجد شرایط دیده نشده است.'}
        </div>
      )}

      <footer className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>صفحهٔ {page} از {pageCount}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            className="rounded border border-slate-700 p-1.5 disabled:opacity-40"
            aria-label="صفحهٔ قبلی"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= (snapshot?.totalWallets ?? 0) || loading}
            className="rounded border border-slate-700 p-1.5 disabled:opacity-40"
            aria-label="صفحهٔ بعدی"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </footer>
    </section>
  );
};
