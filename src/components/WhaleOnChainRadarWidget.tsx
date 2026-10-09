import React, { useEffect, useState } from 'react';
import { Waves, ArrowDownRight, ArrowUpRight, ShieldCheck, Database, RefreshCw, AlertCircle } from 'lucide-react';

export interface WhaleTransfer {
  id: string;
  amountBtc: number;
  usdValueM: number;
  from: string;
  to: string;
  type: 'INFLOW' | 'OUTFLOW';
  timeAgo: string;
}

export interface WhaleRadarData {
  status?: 'LIVE' | 'UNAVAILABLE';
  exchangeNetflowBtc: number | null;
  exchangeReserveBtc: number | null;
  reserveStatus: string;
  whalePressureIndex: number | null;
  whaleSentiment: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' | null;
  summary: string;
  recentWhaleTransfers: WhaleTransfer[];
}

export const WhaleOnChainRadarWidget: React.FC = () => {
  const [data, setData] = useState<WhaleRadarData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchWhaleData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whale-onchain-radar');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWhaleData();
  }, []);

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden transition-all duration-300 hover:border-slate-700">
      {/* Background Glow */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
            <Waves className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">رادار آن‌چین و ردپای نهنگ‌ها (Whale & Netflow Radar)</h3>
            <p className="text-xs text-slate-400 mt-0.5">پایش جریان خروجی/ورودی بیت‌کوین صرافی‌ها و جابه‌جایی‌های بالای ۱۰ میلیون دلار</p>
          </div>
        </div>

        <button
          onClick={fetchWhaleData}
          disabled={loading}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      </div>

      {/* Content */}
      <div className="space-y-4">
        {data?.status === 'UNAVAILABLE' ? (
          <div className="p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-amber-400 font-bold text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>وضعیت داده‌های آن‌چین: UNAVAILABLE</span>
            </div>
            <p className="text-xs text-slate-400">
              ارتباط با منبع زنده رادار آن‌چین و ردیاب نهنگ‌ها در دسترس نیست. جهت حفظ سلامت تصمیم‌گیری، هیچ داده فرضی یا ساختگی نمایش داده نمی‌شود.
            </p>
          </div>
        ) : (
          <>
            {/* Top Summary Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Netflow Card */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <span className="text-[11px] font-medium text-slate-400">جریان خالص صرافی‌ها (Netflow)</span>
                <div className="flex items-center justify-between">
                  <span className={`text-lg font-bold ${typeof data?.exchangeNetflowBtc === 'number' && data.exchangeNetflowBtc < 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {typeof data?.exchangeNetflowBtc === 'number' ? `${data.exchangeNetflowBtc > 0 ? '+' : ''}${data.exchangeNetflowBtc.toLocaleString()} BTC` : 'UNAVAILABLE'}
                  </span>
                  {typeof data?.exchangeNetflowBtc === 'number' ? (
                    data.exchangeNetflowBtc < 0 ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">خروج (انباشت)</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-medium">ورود (فروش)</span>
                    )
                  ) : null}
                </div>
              </div>

              {/* Reserve Status Card */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <span className="text-[11px] font-medium text-slate-400">موجودی بیت‌کوین صرافی‌ها</span>
                <div className="text-base font-bold text-slate-200">
                  {typeof data?.exchangeReserveBtc === 'number' ? `${(data.exchangeReserveBtc / 1000000).toFixed(2)}M BTC` : 'UNAVAILABLE'}
                </div>
                <div className="text-[10px] text-emerald-400 truncate font-medium">{data?.reserveStatus || 'UNAVAILABLE'}</div>
              </div>

              {/* Whale Pressure Index */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                <span className="text-[11px] font-medium text-slate-400">شاخص انباشت نهنگ‌ها</span>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-amber-400">
                    {typeof data?.whalePressureIndex === 'number' ? `${data.whalePressureIndex}%` : 'UNAVAILABLE'}
                  </span>
                  {data?.whaleSentiment && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                      {data.whaleSentiment === 'ACCUMULATION' ? 'انباشت سنگین' : data.whaleSentiment === 'DISTRIBUTION' ? 'عرضه نهنگ' : 'خنثی'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* SB Netflow Insight Banner */}
            {data?.summary && (
              <p className="text-xs text-slate-300 bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 leading-relaxed">
                <strong className="text-emerald-400">بررسی آن‌چین: </strong>
                {data.summary}
              </p>
            )}

            {/* Recent Whale Transactions List */}
            {data?.recentWhaleTransfers && data.recentWhaleTransfers.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-emerald-400" />
                  آخرین تراکنش‌های سنگین ثبت شده در شبکه بیت‌کوین
                </span>

                <div className="space-y-2">
                  {data.recentWhaleTransfers.map((tx) => (
                    <div key={tx.id} className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${tx.type === 'OUTFLOW' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                          {tx.type === 'OUTFLOW' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="font-bold text-slate-200">
                            {tx.amountBtc.toLocaleString()} BTC <span className="text-slate-400 font-normal">(${tx.usdValueM}M)</span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            از <span className="text-slate-300">{tx.from}</span> به <span className="text-slate-300">{tx.to}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className={`text-[10px] font-bold block ${tx.type === 'OUTFLOW' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {tx.type === 'OUTFLOW' ? 'خروج از صرافی (مثبت)' : 'ورود به صرافی (فشار عرضه)'}
                        </span>
                        <span className="text-[10px] text-slate-500">{tx.timeAgo}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
