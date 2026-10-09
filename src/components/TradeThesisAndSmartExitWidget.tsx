import React, { useState, useEffect } from 'react';
import { 
  tradeThesisAndSmartExitEngine, 
  TradeThesisState, 
  SmartLossExitEvaluation, 
  DynamicBreakevenCalculation,
  PostExitSensitivityRecord
} from '../services/tradeThesisAndSmartExitEngine';
import { TradePosition, AnalysisResult } from '../types/trading';
import { 
  ShieldAlert, 
  Activity, 
  Target, 
  Zap, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Flame, 
  Sparkles, 
  RefreshCw,
  Clock,
  TrendingDown,
  Layers,
  Percent,
  Sliders
} from 'lucide-react';

interface Props {
  activePositions?: TradePosition[];
  currentPrice?: number;
  analysis?: AnalysisResult | null;
}

export const TradeThesisAndSmartExitWidget: React.FC<Props> = ({
  activePositions = [],
  currentPrice = 0,
  analysis = null,
}) => {
  const [selectedPosId, setSelectedPosId] = useState<string>('');
  const [postExitHistory, setPostExitHistory] = useState<PostExitSensitivityRecord[]>([]);

  // انتخاب اولین پوزیشن فعال به صورت پیش‌فرض
  useEffect(() => {
    if (activePositions.length > 0 && (!selectedPosId || !activePositions.find(p => p.id === selectedPosId))) {
      setSelectedPosId(activePositions[0].id);
    }
  }, [activePositions, selectedPosId]);

  // بارگذاری سوابق یادگیری پس از خروج
  useEffect(() => {
    setPostExitHistory(tradeThesisAndSmartExitEngine.getPostExitRecords());
    const timer = setInterval(() => {
      setPostExitHistory(tradeThesisAndSmartExitEngine.getPostExitRecords());
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const activePos = activePositions.find(p => p.id === selectedPosId) || activePositions[0] || {
    id: 'sim_pos_sample',
    dir: 'LONG',
    entry: currentPrice > 0 ? currentPrice - 240 : 88200,
    margin: 50,
    lev: 10,
    sl: currentPrice > 0 ? currentPrice - 750 : 87700,
    tp1: currentPrice > 0 ? currentPrice + 650 : 89100,
    tp: currentPrice > 0 ? currentPrice + 1400 : 89850,
    tradeThesis: 'LONG: Trend (EMA50) + CVD Accumulation + OBI Depth + Retest',
    openedAt: '12:30'
  } as TradePosition;

  const isLong = activePos.dir === 'LONG';
  const entry = activePos.entry || currentPrice;
  const lev = activePos.lev || 10;
  const margin = activePos.margin || 50;
  const priceDelta = isLong ? (currentPrice - entry) : (entry - currentPrice);
  const pnlPct = (priceDelta / entry) * 100 * lev;
  const pnlUsd = margin * (pnlPct / 100);

  // ارزیابی‌های زنده با انجین
  const thesisEval: TradeThesisState = tradeThesisAndSmartExitEngine.evaluateTradeThesis(
    activePos,
    currentPrice,
    analysis
  );

  const smartExitEval: SmartLossExitEvaluation = tradeThesisAndSmartExitEngine.evaluateSmartLossExit(
    activePos,
    currentPrice,
    thesisEval,
    analysis
  );

  const dynamicBe: DynamicBreakevenCalculation = tradeThesisAndSmartExitEngine.calculateDynamicBreakeven(
    activePos,
    currentPrice,
    analysis
  );

  const getThesisBadge = (status: TradeThesisState['status']) => {
    switch (status) {
      case 'PRISTINE':
        return <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> مستحکم و معتبر (Pristine)</span>;
      case 'HEALTHY':
        return <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> معتبر با نوسان جزئی (Healthy)</span>;
      case 'DEGRADED':
        return <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> تضعیف شواهد (Degraded)</span>;
      case 'INVALID':
        return <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5" /> ابطال فرضیه (Invalidated)</span>;
    }
  };

  const getSmartLossTierBadge = (tier: SmartLossExitEvaluation['tier']) => {
    switch (tier) {
      case 'NORMAL':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">عادی (پایش امن)</span>;
      case 'WARNING':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">سطح ۱: WARNING (هشدار ضعف)</span>;
      case 'REDUCE':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 animate-pulse">سطح ۲: REDUCE (کاهش ۵۰٪ حجم)</span>;
      case 'EXIT':
        return <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-bounce">سطح ۳: EXIT (خروج اضطراری هوشمند)</span>;
    }
  };

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {/* هدر ماژول */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 border border-cyan-500/30 rounded-xl">
              <ShieldAlert className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-white">پایش فرضیه معامله و خروج هوشمند ۳ سطحی</h3>
                <span className="text-[10px] px-2 py-0.5 bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 rounded-full font-mono">
                  اصول ۳۱ الی ۳۴
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Thesis Monitor • 3-Tier Smart Loss Exit • Dynamic Breakeven • Market Noise Filter
              </p>
            </div>
          </div>

          {/* انتخاب پوزیشن */}
          {activePositions.length > 1 && (
            <div className="flex items-center gap-2 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50">
              <span className="text-xs text-slate-400 px-2">پوزیشن:</span>
              {activePositions.map((pos, idx) => (
                <button
                  key={pos.id || idx}
                  onClick={() => setSelectedPosId(pos.id)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                    (selectedPosId === pos.id || (!selectedPosId && idx === 0))
                      ? 'bg-cyan-500 text-slate-950 shadow-md'
                      : 'text-slate-300 hover:bg-slate-700/50'
                  }`}
                >
                  {pos.dir} ({pos.name || `#${idx + 1}`})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* کارت خلاصه وضعیت پوزیشن جاری */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3.5">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/70">
            <span className="text-[11px] text-slate-400 block mb-1">جهت و فرضیه ورود:</span>
            <div className="flex items-center gap-1.5 font-bold text-sm text-white">
              <span className={isLong ? 'text-emerald-400' : 'text-rose-400'}>
                {isLong ? '▲ LONG' : '▼ SHORT'}
              </span>
              <span className="text-slate-500 text-xs">| اهرم {lev}x</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate mt-1" title={activePos.tradeThesis || thesisEval.thesisSummary}>
              {activePos.tradeThesis || thesisEval.thesisSummary}
            </div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/70">
            <span className="text-[11px] text-slate-400 block mb-1">سود / زیان شناور:</span>
            <div className={`text-base font-black font-mono ${pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
            </div>
            <span className="text-[10px] text-slate-400">مارجین: ${margin.toFixed(1)}</span>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/70">
            <span className="text-[11px] text-slate-400 block mb-1">وضعیت سلامت تز (Thesis):</span>
            <div className="mt-0.5">{getThesisBadge(thesisEval.status)}</div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              سلامت ارکان: {thesisEval.healthyCount} از {thesisEval.totalCount} ({thesisEval.confluenceScore}٪)
            </span>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/70">
            <span className="text-[11px] text-slate-400 block mb-1">سطح خروج هوشمند (Exit Tier):</span>
            <div className="mt-0.5">{getSmartLossTierBadge(smartExitEval.tier)}</div>
            <span className="text-[10px] text-emerald-400 font-bold mt-1 block">
              صرفه‌جویی ضرر: +${smartExitEval.estimatedLossCutSavingsUsd.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* ستون‌های ۳۱ و ۳۲: پایش تز و خروج ۳ سطحی */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ۳۱. مانیتور فاکتورهای Thesis */}
        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-400" />
              <h4 className="text-sm font-bold text-white">۳۱. تفکیک فاکتورهای فرضیه معامله (Thesis Factors)</h4>
            </div>
            <span className="text-xs text-slate-400">
              قانون: ابطال فقط با شکست همزمان Trend + CVD + OBI
            </span>
          </div>

          {thesisEval.corePillarsBroken && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                <strong>هشدار بحرانی:</strong> هر ۳ رکن اصلی (روند + حجم تجمعی CVD + اوردربوک OBI) همزمان شکستند؛ فرضیه معامله کاملاً نقض گردید.
              </span>
            </div>
          )}

          <div className="space-y-2">
            {thesisEval.factors.map((factor) => (
              <div 
                key={factor.id}
                className={`p-3 rounded-xl border transition-all ${
                  factor.isHealthy 
                    ? 'bg-slate-950/40 border-slate-800/60 hover:border-slate-700' 
                    : 'bg-rose-950/20 border-rose-800/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {factor.isHealthy ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span className="text-xs font-bold text-white">{factor.nameFa}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">
                      وزن: {Math.round(factor.weight * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-cyan-300 font-bold">{factor.metricValue}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${factor.score >= 70 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                      {factor.score}/100
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pr-6">{factor.detailsFa}</p>
              </div>
            ))}
          </div>

          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-300">
            <strong>تحلیل رفتار سیستم:</strong>{' '}
            {thesisEval.healthyCount === thesisEval.totalCount 
              ? 'تمامی ۵ فاکتور فرضیه در سلامت کامل هستند؛ معامله با قدرت به سمت تارگت‌ها ادامه می‌دهد.'
              : (thesisEval.corePillarsBroken 
                  ? 'شکست همزمان ارکان سه‌گانه؛ خروج فوری هوشمند برای کاهش ضرر پیش از استاپ سخت فعال گردید.'
                  : `فقط ${thesisEval.totalCount - thesisEval.healthyCount} فاکتور تضعیف شده در حالی که روند اصلی معتبر است؛ پوزیشن بدون خروج زودهنگام و با حفظ فضای تنفس طبیعی نگهداری می‌شود.`)}
          </div>
        </div>

        {/* ۳۲. مدیریت ۳ سطحی Smart Loss Exit و پس‌ارزیابی یادگیری */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <h4 className="text-sm font-bold text-white">۳۲. خروج هوشمند ۳ سطحی در ضرر</h4>
              </div>
            </div>

            {/* ۳ سطح گرافیکی */}
            <div className="space-y-2">
              <div className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${smartExitEval.tier === 'WARNING' ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold' : 'bg-slate-950/40 border-slate-800/60 text-slate-400'}`}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>سطح ۱: WARNING</span>
                </div>
                <span className="text-[11px]">هشدار ضعف اولیه، بدون دستکاری حجم</span>
              </div>

              <div className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${smartExitEval.tier === 'REDUCE' ? 'bg-orange-500/20 border-orange-500/40 text-orange-300 font-bold' : 'bg-slate-950/40 border-slate-800/60 text-slate-400'}`}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-400" />
                  <span>سطح ۲: REDUCE</span>
                </div>
                <span className="text-[11px]">کاهش ۵۰٪ حجم برای مهار ضرر</span>
              </div>

              <div className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${smartExitEval.tier === 'EXIT' ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 font-bold' : 'bg-slate-950/40 border-slate-800/60 text-slate-400'}`}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                  <span>سطح ۳: EXIT</span>
                </div>
                <span className="text-[11px]">خروج اضطراری کامل پیش از استاپ سخت</span>
              </div>
            </div>

            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-300">
              <div className="text-slate-400 mb-1">دلیل تصمیم موتور:</div>
              <p className="leading-relaxed text-slate-200">{smartExitEval.rationaleFa}</p>
            </div>
          </div>

          {/* پس‌ارزیابی یادگیری حساسیت MAE/MFE */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h4 className="text-xs font-bold text-white">یادگیری پس از خروج (MAE/MFE Feedback)</h4>
              </div>
              <span className="text-[10px] text-slate-400">ارزیابی بیش‌حساسیت</span>
            </div>

            {postExitHistory.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-500">
                هنوز خروج زودهنگامی برای پس‌ارزیابی ثبت نشده است. سیستم با هر خروج، رفتار قیمت را تا ۳۰ دقیقه برای سنجش صحت تصمیم تحلیل می‌کند.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {postExitHistory.map((rec, i) => (
                  <div key={rec.positionId || i} className="p-2.5 bg-slate-950/60 border border-slate-800/80 rounded-xl text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-slate-300 text-[11px]">خروج @ ${rec.exitPrice.toFixed(1)}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${rec.wasOptimalCut ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                        {rec.wasOptimalCut ? 'خروج بهینه (نجات سرمایه)' : 'خروج بیش از حد حساس'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-tight">{rec.feedbackFa}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* اصول ۳۳ و ۳۴: Breakeven کاملاً داینامیک و فیلتر زون نویز بازار */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
              <Target className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">۳۳ & ۳۴. مدل بریک‌ایون کاملاً پویا و گیت فعال‌سازی چندبُعدی</h4>
              <p className="text-[11px] text-slate-400">
                حذف مقدار ثابت 0.25$ • محاسبه از Fee + Slippage + Spread + Volatility + Size • جلوگیری از خفه‌کردن موج در Noise Zone
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${dynamicBe.isArmed ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
              {dynamicBe.isArmed ? '✅ بریک‌ایون فعال' : '⏳ در فاز تنفس (BE غیرفعال)'}
            </span>
          </div>
        </div>

        {/* اجزای ۵ گانه محاسبه هزینه */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/70">
            <span className="text-[10px] text-slate-400 block mb-1">۱. کارمزد صرافی (Fee):</span>
            <span className="font-mono font-bold text-cyan-300 text-sm">${dynamicBe.feeUsd.toFixed(2)}</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">نرخ: {dynamicBe.feeRatePct}%</span>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/70">
            <span className="text-[10px] text-slate-400 block mb-1">۲. مدل اسلیپیج واقعی:</span>
            <span className="font-mono font-bold text-cyan-300 text-sm">${dynamicBe.realSlippageUsd.toFixed(2)}</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">{dynamicBe.realSlippageBps} Bps بر اساس عمق</span>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/70">
            <span className="text-[10px] text-slate-400 block mb-1">۳. اسپرد لحظه‌ای (Spread):</span>
            <span className="font-mono font-bold text-cyan-300 text-sm">${dynamicBe.spreadCostUsd.toFixed(2)}</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">{dynamicBe.spreadBps} Bps</span>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/70">
            <span className="text-[10px] text-slate-400 block mb-1">۴. بافر نوسان ATR:</span>
            <span className="font-mono font-bold text-cyan-300 text-sm">${dynamicBe.volatilityBufferUsd.toFixed(2)}</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">ATR: ${dynamicBe.volatilityAtrUsd.toFixed(1)}</span>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/70">
            <span className="text-[10px] text-slate-400 block mb-1">۵. حجم پوزیشن (Size):</span>
            <span className="font-mono font-bold text-emerald-400 text-sm">{dynamicBe.positionSizeBtc} BTC</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">مجموع اصطکاک: ${dynamicBe.totalFrictionUsd.toFixed(2)}</span>
          </div>
        </div>

        {/* فاکتورهای چندبعدی اصل ۳۴ */}
        <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-b border-slate-800/60 pb-2">
            <div>
              <span className="text-slate-400 block text-[10px]">نقطه سربه‌سر پویا (Dynamic BE):</span>
              <span className="font-mono font-bold text-emerald-300 text-sm">${dynamicBe.dynamicBreakevenPrice.toFixed(1)}</span>
              <span className="text-[10px] text-slate-500 block">فاصله: +${dynamicBe.dynamicBreakevenOffsetUsd.toFixed(1)}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px]">سود جاری (Current R):</span>
              <span className={`font-mono font-bold text-sm ${dynamicBe.currentProfitR >= 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {dynamicBe.currentProfitR.toFixed(2)}R
              </span>
              <span className="text-[10px] text-slate-500 block">سود R-Multiple</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px]">زون نویز بازار (Noise Zone):</span>
              <span className={`font-bold text-xs ${dynamicBe.isInMarketNoiseZone ? 'text-amber-400' : 'text-emerald-400'}`}>
                {dynamicBe.isInMarketNoiseZone ? '⚠️ داخل نویز (< ۱.۱x ATR)' : '✅ خارج از نویز'}
              </span>
              <span className="text-[10px] text-slate-500 block">مرز نویز: ${dynamicBe.marketNoiseZoneThresholdUsd.toFixed(1)}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px]">احتمال ادامه موج:</span>
              <span className="font-mono font-bold text-cyan-300 text-sm">{dynamicBe.continuationProbabilityPct}%</span>
              <span className="text-[10px] text-slate-500 block">امتیاز آمادگی: {dynamicBe.activationScore}/100</span>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed pt-1">
            <strong>تحلیل گیت چندبعدی (اصل ۳۴):</strong> {dynamicBe.rationaleFa}
          </p>
        </div>
      </div>
    </div>
  );
};
