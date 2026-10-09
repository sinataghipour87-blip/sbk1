import React from 'react';
import { AnalysisResult } from '../types/trading';
import { BarChart3, Layers, Compass, Waves } from 'lucide-react';

interface StrategyAndIndicatorsProps {
  analysis: AnalysisResult | null;
  aiPrediction?: any;
  settings?: any;
  onSaveSettings?: (s: any) => void;
}

export const StrategyAndIndicators: React.FC<StrategyAndIndicatorsProps> = ({ analysis }) => {
  if (!analysis) {
    return (
      <div className="bg-[#051424] border border-cyan-800/60 rounded-2xl p-6 text-center text-cyan-400 font-mono text-xs animate-pulse">
        در حال بارگذاری تحلیل استراتژی و اندیکاتورها...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Strategy, Money Flow & Fundamentals */}
      <div className="bg-[#051424] border border-cyan-800/60 rounded-2xl p-4 shadow-[0_0_20px_rgba(6,182,212,0.1)] flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 border-b border-cyan-950 pb-2.5 mb-3">
            <Layers className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-mono font-bold tracking-wider text-amber-300">
              استراتژی چندگانه، جریان پول و مشتقات (MONEY FLOW & DERIVATIVES)
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">روند ماکرو تایم 1H / 4H:</span>
              <span className="font-bold text-cyan-300">
                1H: {analysis.mtf1h} | 4H: {analysis.mtf4h}
              </span>
              {analysis.mtfNote && (
                <span className="text-[10px] text-amber-400 block mt-0.5">{analysis.mtfNote}</span>
              )}
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">دلتا حجم تجمعی (CVD):</span>
              <span className={`font-bold ${analysis.cvdDelta === null || analysis.cvdDelta === undefined ? 'text-slate-400' : analysis.cvdDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {analysis.cvdDelta === null || analysis.cvdDelta === undefined ? 'UNKNOWN' : `${analysis.cvdDelta >= 0 ? '+' : ''}${analysis.cvdDelta.toFixed(1)} BTC`}
              </span>
              <span className="text-[9px] text-cyan-300 block truncate" title={analysis.cvdDivergence}>
                {analysis.cvdDivergence || 'UNKNOWN'}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">رادار اسکوئیز و فاندینگ ریت:</span>
              <span className="font-bold text-amber-300">
                {analysis.funding.toFixed(4)}%
              </span>
              <span className="text-[9px] text-amber-400 block truncate" title={analysis.fundingSqueezeSignal}>
                {analysis.fundingSqueezeSignal || analysis.frNote}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">بهره باز (Open Interest):</span>
              <span className="font-bold text-cyan-300">{analysis.oi.toLocaleString('en-US')} BTC</span>
              <span className="text-[10px] text-slate-500 block">حجم موقعیت‌های فعال در بازار</span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">عدم تعادل اردربوک (OBI):</span>
              <span className={`font-bold ${analysis.obi >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {analysis.obi >= 0 ? '+' : ''}{analysis.obi.toFixed(3)}
              </span>
              <span className="text-[10px] text-slate-500 block">
                {analysis.obi > 0 ? 'برتری حجم سفارشات خرید' : 'برتری حجم سفارشات فروش'}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">حجم تعادلی (OBV):</span>
              <span className="font-bold text-slate-200">
                {analysis.obv.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
              <span className={`text-[10px] block ${analysis.obvDiv.includes('هشدار') ? 'text-rose-400 font-bold' : 'text-emerald-400'}`}>
                {analysis.obvDiv}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">شاخص احساسات (ترس و طمع):</span>
              <span className="font-bold text-amber-300">
                {analysis.fngVal !== null && analysis.fngVal !== undefined ? `${analysis.fngVal} از ۱۰۰ (${analysis.fngSent})` : `ناموجود (${analysis.fngSent || 'DATA_UNAVAILABLE'})`}
              </span>
              <span className="text-[10px] text-slate-500 block">احساس کلی سنتیمنت سرمایه‌گذاران</span>
            </div>

            {/* News & Social Sentiment */}
            {analysis.sentiment && (
              <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950 col-span-2">
                <span className="text-[10px] text-slate-400 block">اخبار و سنتیمنت شبکه اجتماعی:</span>
                <div className="flex items-center gap-3 mt-1">
                  <span className={`font-bold ${analysis.sentiment.score > 0 ? 'text-emerald-400' : analysis.sentiment.score < 0 ? 'text-rose-400' : 'text-slate-200'}`}>
                     {analysis.sentiment.label} ({analysis.sentiment.score.toFixed(2)})
                  </span>
                  <span className="text-xs text-slate-400">روند: {analysis.sentiment.trend}</span>
                </div>
                <ul className="text-[10px] text-slate-500 mt-1 list-disc list-inside">
                  {analysis.sentiment.drivers.map((driver, i) => (
                    <li key={`driver_${i}`}>{driver}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-cyan-950/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>سیستم انطباق چند تایم‌فریمی: {analysis.mtfAlignment} از ۵ تایم‌فریم</span>
          <span className="text-cyan-400">تایم‌فریم اجرایی مبنا: 15 دقیقه</span>
        </div>
      </div>

      {/* 2. Technical Indicators Monitor */}
      <div className="bg-[#051424] border border-cyan-800/60 rounded-2xl p-4 shadow-[0_0_20px_rgba(6,182,212,0.1)] flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 border-b border-cyan-950 pb-2.5 mb-3">
            <Compass className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-mono font-bold tracking-wider text-purple-300">
              مجموعه ۱۴ گانه اندیکاتورهای تکنیکال (TECHNICAL INDICATORS MATRIX)
            </h3>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">RSI (14):</span>
              <span className={`font-bold ${analysis.rsi > 70 ? 'text-rose-400' : analysis.rsi < 30 ? 'text-emerald-400' : 'text-cyan-300'}`}>
                {analysis.rsi.toFixed(1)}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">Stoch RSI:</span>
              <span className="font-bold text-slate-200">{analysis.stoch.toFixed(1)}%</span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">ADX قدرت روند:</span>
              <span className={`font-bold ${analysis.adx >= 25 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {analysis.adx.toFixed(1)}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">+DI / -DI:</span>
              <span className="font-bold text-slate-200">
                +{analysis.pdi.toFixed(0)} / -{analysis.mdi.toFixed(0)}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">CCI (20):</span>
              <span className="font-bold text-slate-200">{analysis.cci.toFixed(1)}</span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">Williams %R:</span>
              <span className="font-bold text-slate-200">{analysis.wr.toFixed(1)}%</span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">MFI جریان پول:</span>
              <span className="font-bold text-cyan-300">{analysis.mfi.toFixed(1)}</span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">VWAP (50):</span>
              <span className="font-bold text-slate-200">${analysis.vwap.toFixed(0)}</span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">ATR نوسان:</span>
              <span className="font-bold text-amber-400">${analysis.atr.toFixed(1)}</span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950">
              <span className="text-[10px] text-slate-400 block">Momentum (10):</span>
              <span className={`font-bold ${analysis.mom >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {analysis.mom >= 0 ? '+' : ''}{analysis.mom.toFixed(1)}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-[#020b17] border border-cyan-950 col-span-2">
              <span className="text-[10px] text-slate-400 block">میانگین‌های متحرک:</span>
              <span className="font-mono text-[11px] text-slate-300">
                EMA20: ${analysis.ema20Val.toFixed(0)} | EMA50: ${analysis.ema50Val.toFixed(0)} | EMA200: ${analysis.ema200Val.toFixed(0)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-cyan-950/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-1.5 text-cyan-400">
            <Waves className="w-3.5 h-3.5" />
            <span>مکدی هیستوگرام: {analysis.macdH[analysis.macdH.length - 1]?.toFixed(2) || '0.00'}</span>
          </div>
          <span>Supertrend: {analysis.supertrend}</span>
        </div>
      </div>
    </div>
  );
};
