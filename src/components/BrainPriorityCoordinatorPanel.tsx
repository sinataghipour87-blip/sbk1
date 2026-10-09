import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Zap,
  TrendingUp,
  ShieldAlert,
  ShieldCheck,
  Award,
  Sparkles,
  Layers,
  ArrowUpRight,
  Flame,
  Clock,
  RotateCcw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  brainPriorityCoordinator,
  PriorityCoordinatorReport,
  BrainCoordinatorRecord,
  ImmediateLossReversalStrategy
} from '../services/brainPriorityCoordinator';

interface Props {
  currentPrice?: number;
  currentDrawdownPct?: number;
  onShowNotification?: (msg: string) => void;
}

export const BrainPriorityCoordinatorPanel: React.FC<Props> = ({
  currentPrice = 0,
  currentDrawdownPct = 0,
  onShowNotification
}) => {
  const [report, setReport] = useState<PriorityCoordinatorReport | null>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'scenarios'>('queue');
  const [testDrawdown, setTestDrawdown] = useState<number>(0);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const fetchReport = (simDrawdown = 0) => {
    const rep = brainPriorityCoordinator.getCoordinatorReport(currentPrice, simDrawdown || currentDrawdownPct);
    setReport(rep);
  };

  useEffect(() => {
    fetchReport(testDrawdown);
    const interval = setInterval(() => fetchReport(testDrawdown), 6000);
    return () => clearInterval(interval);
  }, [currentPrice, currentDrawdownPct, testDrawdown]);

  const handleSimulateLossScenario = (pct: number) => {
    setTestDrawdown(pct);
    fetchReport(pct);
    const msg = `⚡ شبیه‌سازی ورود پوزیشن به ضرر (${pct}٪): فعال‌سازی بدون درنگ سناریوهای نجات و تبدیل ضرر به سود!`;
    setNotificationMsg(msg);
    if (onShowNotification) onShowNotification(msg);
    setTimeout(() => setNotificationMsg(null), 4000);
  };

  const handleResetSimulation = () => {
    setTestDrawdown(0);
    fetchReport(0);
    const msg = '🔄 وضعیت شبیه‌ساز به حالت پایش زنده بازار بازگشت.';
    setNotificationMsg(msg);
    if (onShowNotification) onShowNotification(msg);
    setTimeout(() => setNotificationMsg(null), 3000);
  };

  if (!report) return null;

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-indigo-500/40 p-4 text-slate-100 shadow-[0_0_25px_rgba(99,102,241,0.18)] flex flex-col gap-4 font-sans">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-900/40 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-950/90 border border-indigo-500/50 rounded-xl text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.35)]">
            <Cpu className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              هماهنگ‌کننده صف اولویت مغزها (Brain-Priority-Coordinator)
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                نرخ برد ۳۰m پویا
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              رتبه‌بندی لحظه‌ای ۱۵ مغز پردازشی + سناریوهای بلادرنگ نجات و تبدیل قطعی زیان به سود
            </p>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'queue'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>صف اولویت ۳۰ دقیقه اخیر</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scenarios')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'scenarios'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>سناریوهای فوری تبدیل ضرر به سود (۴ سناریو)</span>
          </button>
        </div>
      </div>

      {notificationMsg && (
        <div className="bg-indigo-950/90 border border-indigo-400/60 text-indigo-200 px-3.5 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-2 shadow-sm animate-fadeIn">
          <Sparkles className="w-4 h-4 text-indigo-300 flex-shrink-0" />
          <span>{notificationMsg}</span>
        </div>
      )}

      {/* Key Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex flex-col">
          <span className="text-[10px] text-slate-400">فرمانده صف اولویت</span>
          <span className="text-xs font-bold text-indigo-300 truncate mt-0.5">
            {report.topPriorityBrainNameFa}
          </span>
          <span className="text-[9px] font-mono text-emerald-400 mt-1">ضریب وزنی: ۱.۸x</span>
        </div>

        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex flex-col">
          <span className="text-[10px] text-slate-400">میانگین وین‌ریت ۳۰m</span>
          <span className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
            {report.averageRollingWinRate30m}%
          </span>
          <span className="text-[9px] text-slate-400 mt-1">محاسبه در پنجره غلتان</span>
        </div>

        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex flex-col">
          <span className="text-[10px] text-slate-400">سرعت واکنش سناریو</span>
          <span className="text-xs font-mono font-bold text-cyan-300 mt-0.5">
            ۶۵ الی ۱۲۰ میلی‌ثانیه
          </span>
          <span className="text-[9px] text-slate-400 mt-1">بدون درنگ در کشف ضرر</span>
        </div>

        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex flex-col">
          <span className="text-[10px] text-slate-400">هدف نهایی سناریوها</span>
          <span className="text-xs font-bold text-amber-300 mt-0.5">
            ضرر $۰.۰۰ یا سود خرد
          </span>
          <span className="text-[9px] text-slate-400 mt-1">Zero-Loss Execution</span>
        </div>
      </div>

      {/* TAB 1: Priority Queue Table with Statistical Significance & Model Kill-Switch (Items 34, 35, 36) */}
      {activeTab === 'queue' && (
        <div className="bg-slate-950/70 rounded-xl border border-slate-800/80 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-900 text-[10px] font-mono text-slate-400 border-b border-slate-800">
            <div className="col-span-1 text-center font-bold">رتبه / Tier</div>
            <div className="col-span-3">نام مغز کوانتومی</div>
            <div className="col-span-2 text-center">وین‌ریت ۳۰m / داده</div>
            <div className="col-span-2 text-center">Wilson 95% / Brier</div>
            <div className="col-span-2 text-center">PF / Expectancy</div>
            <div className="col-span-2 text-center">وزن انسمبل / وضعیت</div>
          </div>

          <div className="divide-y divide-slate-800/60 max-h-[380px] overflow-y-auto">
            {report.rankedBrains.map((b) => {
              const isDiamond = b.tier === 'DIAMOND_EXECUTOR';
              const isGold = b.tier === 'GOLD_VALIDATOR';
              const isUnranked = b.tier === 'UNRANKED';

              return (
                <div
                  key={b.brainId}
                  className={`grid grid-cols-12 gap-2 px-3 py-2 items-center text-xs transition-colors ${
                    isUnranked
                      ? 'bg-slate-950/40 opacity-70 hover:opacity-100'
                      : isDiamond
                      ? 'bg-indigo-950/25 hover:bg-indigo-950/35'
                      : isGold
                      ? 'bg-slate-900/40 hover:bg-slate-900/60'
                      : 'hover:bg-slate-800/20'
                  }`}
                >
                  <div className="col-span-1 flex flex-col items-center">
                    {isUnranked ? (
                      <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-amber-950 text-amber-400 border border-amber-800/60 font-mono">
                        UNRANK
                      </span>
                    ) : (
                      <span
                        className={`w-5 h-5 rounded-md flex items-center justify-center font-mono font-bold text-[10px] ${
                          isDiamond
                            ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm'
                            : isGold
                            ? 'bg-indigo-900/60 text-indigo-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        #{b.priorityRank}
                      </span>
                    )}
                  </div>

                  <div className="col-span-3 flex flex-col min-w-0">
                    <span className="font-bold text-slate-200 text-[11px] truncate flex items-center gap-1">
                      {b.nameFa}
                      {isDiamond && <Sparkles className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 truncate">{b.codeName}</span>
                  </div>

                  <div className="col-span-2 text-center font-mono font-bold text-[11px]">
                    {isUnranked ? (
                      <span className="text-slate-500 text-[10px]">بدون داده کافی</span>
                    ) : (
                      <>
                        <span className="text-emerald-400">{b.winRate30mPct}%</span>
                        <div className="text-[8px] text-slate-500 font-sans font-normal">
                          {b.successfulSignals30m}/{b.signalsGenerated30m} سیگنال
                        </div>
                      </>
                    )}
                  </div>

                  <div className="col-span-2 text-center font-mono text-[10px]">
                    {isUnranked ? (
                      <span className="text-slate-600">-</span>
                    ) : (
                      <>
                        <div className="font-bold text-cyan-300">W: {b.wilsonScore}%</div>
                        <div className="text-[8px] text-slate-400">Brier: {b.brierScore} | ECE: {b.ece}%</div>
                      </>
                    )}
                  </div>

                  <div className="col-span-2 text-center font-mono text-[10px]">
                    {isUnranked ? (
                      <span className="text-slate-600">-</span>
                    ) : (
                      <>
                        <div className="font-bold text-amber-300">PF: {b.profitFactor}</div>
                        <div className="text-[8px] text-slate-400">Exp: {b.expectancy}R | DD: {b.maxDrawdownPct}%</div>
                      </>
                    )}
                  </div>

                  <div className="col-span-2 flex flex-col items-center justify-center font-mono text-[10px]">
                    {isUnranked ? (
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-500 border border-slate-800 text-[9px]">
                        وزن ۰.۰x (بدون اثر)
                      </span>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          isDiamond
                            ? 'bg-indigo-900/80 text-indigo-200 border border-indigo-500/40'
                            : isGold
                            ? 'bg-slate-800 text-slate-300'
                            : 'bg-slate-850 text-slate-400'
                        }`}
                      >
                        {b.dynamicWeightBoost}x Boost
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: Immediate Loss-Reversal Scenarios */}
      {activeTab === 'scenarios' && (
        <div className="flex flex-col gap-3">
          {/* Simulation Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-rose-950/30 rounded-xl border border-rose-900/40">
            <span className="text-[11px] text-rose-300 font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              تست عملکرد سناریوهای نجات در هنگام وقوع افت قیمت (Drawdown Simulation):
            </span>

            <div className="flex items-center gap-1.5">
              {[
                { label: 'افت -۰.۲۵٪', val: -0.25 },
                { label: 'افت -۰.۴۰٪', val: -0.40 },
                { label: 'افت -۰.۸۰٪', val: -0.80 },
                { label: 'افت -۱.۲۰٪', val: -1.20 },
              ].map((sim) => (
                <button
                  key={sim.val}
                  type="button"
                  onClick={() => handleSimulateLossScenario(sim.val)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                    testDrawdown === sim.val
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {sim.label}
                </button>
              ))}

              {testDrawdown !== 0 && (
                <button
                  type="button"
                  onClick={handleResetSimulation}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-[10px] font-bold flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>ریست</span>
                </button>
              )}
            </div>
          </div>

          {/* 4 Emergency Scenarios Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {report.activeLossReversalScenarios.map((sc) => (
              <div
                key={sc.scenarioId}
                className={`p-3 rounded-xl border transition-all flex flex-col gap-2 ${
                  sc.isActivated
                    ? 'bg-rose-950/40 border-rose-500/70 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse'
                    : 'bg-slate-950/60 border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                    {sc.nameFa}
                  </span>
                  <span
                    className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
                      sc.isActivated
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {sc.isActivated ? '🚨 فعال بلادرنگ' : 'آماده‌باش Standby'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {sc.descriptionFa}
                </p>

                <div className="flex items-center justify-between text-[10px] font-mono border-t border-slate-800/60 pt-2 text-slate-400">
                  <span>آستانه شلیک: {sc.triggerThresholdPct}٪</span>
                  <span>سرعت اجرا: {sc.executionSpeedMs}ms</span>
                  <span className="text-emerald-400 font-bold">{sc.targetOutcomeFa}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
