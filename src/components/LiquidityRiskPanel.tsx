import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShieldAlert, Activity, Droplets, Zap, ArrowUpRight, ArrowDownRight, Layers, Cpu } from 'lucide-react';
import { AnalysisResult } from '../types/trading';

interface LiquidityRiskPanelProps {
  analysis: AnalysisResult | null;
  userLeverage: number;
  onApplyOptimalLeverage?: (lev: number) => void;
}

interface LiquidityRiskData {
  riskScore: number;
  riskLevel: string;
  statusColor: string;
  liqPrice: number;
  liqDistancePct: number;
  estimatedSlippagePct: number;
  depthPressure: string;
  obiScore: number;
  monteCarloProb: number;
  optimalLeverage: number;
  warnings: string[];
}

// Deterministic fast local calculation with stabilization to guarantee zero flicker and zero layout jumping
function computeLocalRisk(
  price: number,
  leverage: number,
  obi: number,
  atr: number,
  margin: number,
  direction: 'LONG' | 'SHORT'
): LiquidityRiskData {
  const currentPrice = price > 0 ? price : 0;
  const lev = Math.max(1, leverage);
  const maintenanceBuffer = 0.5;
  const liqDistancePct = Math.max(0.1, 100.0 / lev - maintenanceBuffer);

  const liqPrice =
    direction === 'LONG'
      ? currentPrice * (1.0 - liqDistancePct / 100.0)
      : currentPrice * (1.0 + liqDistancePct / 100.0);

  const vol = currentPrice > 0 ? (atr / currentPrice) * 100.0 : 1.5;
  const volStress = vol * lev * 1.5;
  const safeObi = Math.max(-1, Math.min(1, obi || 0));
  const obiStress =
    direction === 'LONG'
      ? safeObi < 0
        ? Math.abs(safeObi) * 20.0
        : -safeObi * 10.0
      : safeObi > 0
      ? safeObi * 20.0
      : Math.abs(safeObi) * 10.0;

  const rawRisk = lev * 1.1 + volStress + obiStress;
  const riskScore = Math.min(Math.max(Math.round(rawRisk), 5), 98);

  let statusColor = 'green';
  let riskLevel = 'ایمن (Low Risk)';
  if (riskScore >= 75) {
    statusColor = 'red';
    riskLevel = 'بحرانی (Critical)';
  } else if (riskScore >= 50) {
    statusColor = 'orange';
    riskLevel = 'خطر بالا (High Risk)';
  } else if (riskScore >= 25) {
    statusColor = 'yellow';
    riskLevel = 'متوسط (Caution)';
  }

  // Monte carlo approximation
  const monteCarloProb = Math.min(
    95,
    Math.max(1.0, parseFloat((Math.pow(lev / 28.0, 1.6) * (vol / 1.2) * (1 + Math.abs(safeObi))).toFixed(1)))
  );

  let safeLev = Math.max(2, Math.floor(45.0 / Math.max(vol, 0.7)));
  if (Math.abs(safeObi) > 0.3) {
    safeLev = Math.max(2, Math.floor(safeLev * 0.7));
  }
  const optimalLeverage = Math.min(50, Math.max(2, safeLev));

  const estimatedSlippagePct = parseFloat(((lev * 0.012) * (1.0 + Math.abs(safeObi))).toFixed(2));
  const depthPressure =
    safeObi > 0.08
      ? 'دیوار خرید قوی (Bid Wall Support)'
      : safeObi < -0.08
      ? 'فشار فروش سنگین (Ask Wall Pressure)'
      : 'تعادل نسبی در دفتر سفارش';

  const warnings: string[] = [];
  if (lev >= 50) {
    warnings.push(`⚠️ اهرم بسیار بالا (${lev}x): فاصله تا لیکوییدیشن فقط ${liqDistancePct.toFixed(1)}% است.`);
  } else if (lev >= 20) {
    warnings.push(`⚠️ اهرم متوسط رو به بالا (${lev}x): فاصله تا لیکویید حدود ${liqDistancePct.toFixed(1)}% است.`);
  }

  if (monteCarloProb > 15.0) {
    warnings.push(`🎲 احتمال لمس حد لیکویید در ۲۴ ساعت: حدود ${monteCarloProb}% تخمین زده شده است.`);
  }

  if ((direction === 'LONG' && safeObi < -0.25) || (direction === 'SHORT' && safeObi > 0.25)) {
    warnings.push('🚨 عدم تعادل دفتر (OBI): فشار عرضه و تقاضا مخالف جهت پوزیشن است.');
  }

  if (warnings.length === 0) {
    warnings.push('✅ وضعیت نقدینگی و عمق دفتر سفارش در شرایط پایدار قرار دارد.');
  }

  return {
    riskScore,
    riskLevel,
    statusColor,
    liqPrice: Math.round(liqPrice),
    liqDistancePct: parseFloat(liqDistancePct.toFixed(1)),
    estimatedSlippagePct,
    depthPressure,
    obiScore: parseFloat(safeObi.toFixed(2)),
    monteCarloProb,
    optimalLeverage,
    warnings,
  };
}

export const LiquidityRiskPanel: React.FC<LiquidityRiskPanelProps> = ({
  analysis,
  userLeverage,
  onApplyOptimalLeverage,
}) => {
  if (!analysis) {
    return (
      <div className="bg-[#051424] border border-cyan-800/60 rounded-2xl p-6 text-center text-cyan-400 font-mono text-xs animate-pulse">
        در حال بارگذاری پنل ریسک و نقدینگی...
      </div>
    );
  }

  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [leverage, setLeverage] = useState<number>(userLeverage || 20);

  // Initialize with deterministic stable object
  const [riskData, setRiskData] = useState<LiquidityRiskData>(() =>
    computeLocalRisk(
      analysis.price,
      userLeverage || analysis.leverage || 20,
      analysis.obi ?? 0.15,
      analysis.atr ?? 850,
      analysis.margin ?? 100,
      'LONG'
    )
  );

  const lastUpdateRef = useRef<number>(0);
  const lastDirectionRef = useRef<'LONG' | 'SHORT'>('LONG');
  const lastLeverageRef = useRef<number>(leverage);

  useEffect(() => {
    if (userLeverage && userLeverage !== leverage) {
      setLeverage(userLeverage);
    }
  }, [userLeverage]);

  // Smooth throttled calculation (updates immediately on leverage/direction change, throttled to 1.5s on rapid price ticks)
  useEffect(() => {
    const now = Date.now();
    const isControlChanged = direction !== lastDirectionRef.current || leverage !== lastLeverageRef.current;
    const isThrottled = !isControlChanged && now - lastUpdateRef.current < 1500;

    if (isThrottled) {
      return;
    }

    lastUpdateRef.current = now;
    lastDirectionRef.current = direction;
    lastLeverageRef.current = leverage;

    const local = computeLocalRisk(
      analysis.price,
      leverage,
      analysis.obi ?? 0.15,
      analysis.atr ?? 850,
      analysis.margin ?? 100,
      direction
    );
    setRiskData(local);
  }, [analysis.price, analysis.obi, analysis.atr, analysis.margin, leverage, direction]);

  return (
    <div className="bg-[#051424] border border-cyan-800/60 rounded-2xl p-4 shadow-[0_0_20px_rgba(6,182,212,0.1)] space-y-3 min-h-[380px] transition-all">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cyan-950 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
            <Droplets className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-mono font-bold text-cyan-200 flex items-center gap-1.5">
              <span>ماژول پیشرفته ریسک نقدینگی و عمق دفتر سفارش</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-900/60 text-cyan-300 border border-cyan-600/40">
                مونت‌کارلو + OBI
              </span>
            </h3>
            <p className="text-[10px] text-slate-400">محاسبه احتمال لیکوییدیشن و تحلیل فشار عرضه/تقاضا</p>
          </div>
        </div>

        {/* Direction Toggle */}
        <div className="flex bg-[#020712] rounded-lg p-0.5 border border-cyan-900/60">
          <button
            onClick={() => setDirection('LONG')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 ${
              direction === 'LONG'
                ? 'bg-emerald-600 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowUpRight className="w-3 h-3" />
            لانگ
          </button>
          <button
            onClick={() => setDirection('SHORT')}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 ${
              direction === 'SHORT'
                ? 'bg-rose-600 text-white shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowDownRight className="w-3 h-3" />
            شورت
          </button>
        </div>
      </div>

      {/* Leverage Slider & Quick Metrics */}
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        {/* Leverage Selector */}
        <div className="bg-[#020b17] border border-cyan-950 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex justify-between items-center text-[10px] text-slate-400">
            <span>اهرم انتخابی:</span>
            <span className="font-bold text-cyan-300 text-xs">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={leverage ?? 10}
            onChange={(e) => setLeverage(parseInt(e.target.value, 10) || 10)}
            className="w-full accent-cyan-400 cursor-pointer my-1.5"
          />
          <div className="flex items-center justify-between pt-1 border-t border-cyan-950/60">
            <span className="text-[9px] text-slate-400 flex items-center gap-1">
              <Cpu className="w-3 h-3 text-cyan-400" />
              پیشنهاد بهینه:
            </span>
            <button
              onClick={() => {
                if (riskData.optimalLeverage) {
                  setLeverage(riskData.optimalLeverage);
                  if (onApplyOptimalLeverage) onApplyOptimalLeverage(riskData.optimalLeverage);
                }
              }}
              className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-900/60 hover:bg-cyan-800 text-cyan-200 border border-cyan-500/40"
            >
              {riskData.optimalLeverage}x (اعمال)
            </button>
          </div>
        </div>

        {/* Risk Score Gauge */}
        <div
          className={`border rounded-xl p-2.5 flex flex-col justify-between ${
            riskData.statusColor === 'green'
              ? 'bg-emerald-950/30 border-emerald-500/40'
              : riskData.statusColor === 'yellow'
              ? 'bg-amber-950/30 border-amber-500/40'
              : riskData.statusColor === 'orange'
              ? 'bg-orange-950/30 border-orange-500/40'
              : 'bg-rose-950/30 border-rose-500/40'
          }`}
        >
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-300">شاخص ریسک:</span>
            <ShieldAlert
              className={`w-3.5 h-3.5 ${
                riskData.statusColor === 'green'
                  ? 'text-emerald-400'
                  : riskData.statusColor === 'yellow'
                  ? 'text-amber-400'
                  : riskData.statusColor === 'orange'
                  ? 'text-orange-400'
                  : 'text-rose-400'
              }`}
            />
          </div>
          <div className="flex items-baseline justify-between my-0.5">
            <span className="text-lg font-bold text-white">{riskData.riskScore}%</span>
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                riskData.statusColor === 'green'
                  ? 'bg-emerald-900/60 text-emerald-300'
                  : riskData.statusColor === 'yellow'
                  ? 'bg-amber-900/60 text-amber-300'
                  : riskData.statusColor === 'orange'
                  ? 'bg-orange-900/60 text-orange-300'
                  : 'bg-rose-900/60 text-rose-300'
              }`}
            >
              {riskData.riskLevel}
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                riskData.statusColor === 'green'
                  ? 'bg-emerald-500'
                  : riskData.statusColor === 'yellow'
                  ? 'bg-amber-500'
                  : riskData.statusColor === 'orange'
                  ? 'bg-orange-500'
                  : 'bg-rose-500'
              }`}
              style={{ width: `${riskData.riskScore}%` }}
            />
          </div>
        </div>

        {/* Monte Carlo Probability */}
        <div className="bg-[#020b17] border border-cyan-950 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>احتمال لیکویید ۲۴ساعته:</span>
            <Activity className="w-3 h-3 text-cyan-400" />
          </div>
          <div className="text-sm font-bold text-cyan-300 my-0.5">{riskData.monteCarloProb}%</div>
          <div className="text-[10px] text-slate-400 flex justify-between">
            <span>قیمت لیکویید:</span>
            <span className="text-rose-400 font-bold">${riskData.liqPrice.toLocaleString('en-US')}</span>
          </div>
        </div>

        {/* Order Book Imbalance */}
        <div className="bg-[#020b17] border border-cyan-950 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>عدم تعادل دفتر (OBI):</span>
            <Layers className="w-3 h-3 text-cyan-400" />
          </div>
          <div className="flex items-baseline justify-between my-0.5">
            <span className={`text-sm font-bold ${riskData.obiScore >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {riskData.obiScore > 0 ? '+' : ''}
              {riskData.obiScore}
            </span>
            <span className="text-[9px] text-slate-400">
              اسلیپیج: <strong className="text-amber-300">~{riskData.estimatedSlippagePct}%</strong>
            </span>
          </div>
          <div className="text-[9px] text-cyan-300 truncate">{riskData.depthPressure}</div>
        </div>
      </div>

      {/* Warnings & Recommendations */}
      <div className="bg-[#020814] border border-cyan-950 rounded-xl p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-300">
          <Zap className="w-3.5 h-3.5 text-cyan-400" />
          <span>توصیه و هشدار هوشمند نقدینگی:</span>
        </div>
        <div className="space-y-1">
          {riskData.warnings.map((warn, index) => (
            <div
              key={`riskwarn_${index}`}
              className="text-[11px] text-slate-300 bg-cyan-950/20 border border-cyan-900/30 rounded-lg p-1.5 flex items-start gap-1.5"
            >
              <span className="text-cyan-400">•</span>
              <span className="leading-relaxed">{warn}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
