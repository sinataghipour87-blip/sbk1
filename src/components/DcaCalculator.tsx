import React, { useState } from 'react';
import { Calculator, TrendingUp, DollarSign, Calendar, ShieldCheck } from 'lucide-react';

interface DcaCalculatorProps {
  currentBalance: number;
}

export const DcaCalculator: React.FC<DcaCalculatorProps> = ({ currentBalance }) => {
  const [monthlyDeposit, setMonthlyDeposit] = useState<number>(100);
  const [expectedMonthlyReturn, setExpectedMonthlyReturn] = useState<number>(12); // 12% per month
  const [months, setMonths] = useState<number>(12); // 1, 3, 6, 12 months

  // Compound Interest & DCA Formula
  let projectedBalance = currentBalance;
  let totalDeposited = currentBalance;

  for (let m = 0; m < months; m++) {
    projectedBalance = (projectedBalance + monthlyDeposit) * (1 + expectedMonthlyReturn / 100);
    totalDeposited += monthlyDeposit;
  }

  const netProfit = projectedBalance - totalDeposited;
  const profitPercentage = totalDeposited > 0 ? (netProfit / totalDeposited) * 100 : 0;

  return (
    <div className="bg-[#051424] border border-cyan-800/60 rounded-2xl p-4 shadow-[0_0_20px_rgba(6,182,212,0.1)] space-y-4">
      <div className="flex items-center justify-between border-b border-cyan-950 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
            <Calculator className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-mono font-bold tracking-wider text-cyan-100">
            ماشین‌حساب سود مرکب و سرمایه‌گذاری پله‌ای (DCA & Compound)
          </h3>
        </div>
        <span className="text-[11px] font-mono text-cyan-400/80">شبیه‌ساز رشد سرمایه</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
        <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950 space-y-1.5">
          <label className="text-slate-400 flex items-center gap-1 text-[11px]">
            <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
            <span>واریز ماهانه (DCA):</span>
          </label>
          <input
            type="number"
            value={monthlyDeposit ?? 0}
            onChange={(e) => setMonthlyDeposit(Math.max(0, parseFloat(e.target.value) || 0))}
            step="50"
            className="w-full bg-[#030d1a] border border-cyan-800/80 rounded-lg px-3 py-1.5 text-cyan-300 font-bold focus:outline-none focus:border-cyan-400"
          />
        </div>

        <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950 space-y-1.5">
          <label className="text-slate-400 flex items-center gap-1 text-[11px]">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>بازدهی ماهانه مورد انتظار (%):</span>
          </label>
          <input
            type="number"
            value={expectedMonthlyReturn ?? 0}
            onChange={(e) => setExpectedMonthlyReturn(parseFloat(e.target.value) || 0)}
            step="1"
            min="1"
            max="100"
            className="w-full bg-[#030d1a] border border-cyan-800/80 rounded-lg px-3 py-1.5 text-emerald-400 font-bold focus:outline-none focus:border-cyan-400"
          />
        </div>

        <div className="bg-[#020b17] p-3 rounded-xl border border-cyan-950 space-y-1.5">
          <label className="text-slate-400 flex items-center gap-1 text-[11px]">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>بازه زمانی (ماه):</span>
          </label>
          <select
            value={months}
            onChange={(e) => setMonths(parseInt(e.target.value, 10))}
            className="w-full bg-[#030d1a] border border-cyan-800/80 rounded-lg px-3 py-1.5 text-amber-300 font-bold focus:outline-none focus:border-cyan-400"
          >
            <option value={3}>۳ ماه</option>
            <option value={6}>۶ ماه</option>
            <option value={12}>۱۲ ماه (۱ سال)</option>
            <option value={24}>۲۴ ماه (۲ سال)</option>
          </select>
        </div>
      </div>

      {/* Projection Result Card */}
      <div className="bg-gradient-to-br from-cyan-950/50 to-blue-950/30 border border-cyan-500/40 rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-mono border-b border-cyan-900/50 pb-2">
          <span className="text-slate-300">کل سرمایه وارد شده (آورده + واریز):</span>
          <span className="font-bold text-slate-200">${totalDeposited.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
        </div>

        <div className="flex items-center justify-between text-xs font-mono border-b border-cyan-900/50 pb-2">
          <span className="text-slate-300">سود خالص پیش‌بینی شده:</span>
          <span className="font-bold text-emerald-400">+${netProfit.toLocaleString('en-US', { maximumFractionDigits: 2 })} ({profitPercentage.toFixed(1)}%)</span>
        </div>

        <div className="flex items-center justify-between text-sm font-mono pt-1">
          <span className="text-cyan-200 font-bold flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            ارزش نهایی پورتفو:
          </span>
          <span className="font-black text-cyan-300 text-base">
            ${projectedBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT
          </span>
        </div>
      </div>
    </div>
  );
};
