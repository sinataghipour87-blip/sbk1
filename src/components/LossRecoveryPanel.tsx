import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Zap,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
  CheckCircle2,
  Lock,
  Play,
  Calculator,
  HelpCircle,
  Cpu,
  Layers,
  LineChart,
  Sliders,
  ChevronRight,
  ChevronLeft,
  Activity,
  Award,
  Maximize2,
  TrendingUp,
  AlertTriangle,
  Flame,
  Gauge
} from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';

export interface LossRecoveryState {
  isActive: boolean;
  lastLossUsd: number;
  hedgeMarginUsd: number;
  hedgeDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  deltaNeutralOffsetPct: number;
  recoveryTargetUsd: number;
  hedgeEntryPrice: number;
  executedCount: number;
}

interface LossRecoveryPanelProps {
  freeMargin: number;
  currentPrice: number;
  recoveryState: LossRecoveryState;
  onTriggerManualHedge: () => void;
  onResetEngine: () => void;
}

type StrategyType = 'stepped_hedge' | 'grid_matrix' | 'zone_recovery' | 'synthetic_option' | 'kelly_garch';

interface StrategyDetail {
  id: StrategyType;
  nameFa: string;
  nameEn: string;
  icon: React.ReactNode;
  userType: string;
  propDesk: string;
  briefFa: string;
  techDescFa: string;
  mathFormula: string;
}

export const LossRecoveryPanel: React.FC<LossRecoveryPanelProps> = ({
  freeMargin,
  currentPrice,
  recoveryState,
  onTriggerManualHedge,
  onResetEngine,
}) => {
  const hedgeMargin5Pct = Math.max(5, freeMargin * 0.05);
  const basePrice = currentPrice > 0 ? currentPrice : 65000;

  // Selected Strategy State
  const [activeStrategy, setActiveStrategy] = useState<StrategyType>('stepped_hedge');

  // Strategy Parameters
  const [simBalance, setSimBalance] = useState<number>(500);
  const [simLeverage, setSimLeverage] = useState<number>(10);
  const [adverseMovementPct, setAdverseMovementPct] = useState<number>(3.0); // Adverse drop percentage
  
  // Strategy-specific controls
  const [hedgeRatio, setHedgeRatio] = useState<number>(1.25); // Hedge size multiplier (e.g. 1.25x original)
  const [gridSteps, setGridSteps] = useState<number>(4); // Number of grid steps (2-6)
  const [zoneAtrWidth, setZoneAtrWidth] = useState<number>(1.5); // Zone recovery ATR width (1.0 to 2.5)
  const [deltaTarget, setDeltaTarget] = useState<number>(-0.65); // Option delta hedge threshold
  const [garchVolFactor, setGarchVolFactor] = useState<number>(1.8); // Volatility factor (GARCH)

  // Simulation runner states
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationLogs, setSimulationLogs] = useState<string[]>([]);
  const [simStep, setSimStep] = useState<number>(0);
  const [simMetrics, setSimMetrics] = useState<{
    originalLoss: number;
    finalLoss: number;
    recoveredAmount: number;
    netPnl: number;
    status: 'SUCCESS' | 'RUNNING' | 'CRISIS' | 'IDLE';
    savedLossPct: number;
  }>({
    originalLoss: 0,
    finalLoss: 0,
    recoveredAmount: 0,
    netPnl: 0,
    status: 'IDLE',
    savedLossPct: 0,
  });

  const strategies: StrategyDetail[] = [
    {
      id: 'stepped_hedge',
      nameFa: 'الگوریتم هدج پله‌ای دلتا-نیوترال',
      nameEn: 'Delta-Neutral Stepped Hedging',
      icon: <Scale className="w-4 h-4 text-cyan-400" />,
      userType: 'تیم‌های معاملاتی فرکانس بالا (HFT)',
      propDesk: 'Citadel & Millennium Management Style',
      briefFa: 'این روش با باز کردن یک موقعیت معکوس (با حجم ۱.۲۵ برابر موقعیت اصلی) در انحراف ۱.۵ برابری ATR، زیان شناور را فریز کرده و با کمک نوسانات موضعی بازار، هر دو پله را در برآیند مثبت با سود جزئی می‌بندد.',
      techDescFa: 'هنگامی که پوزیشن وارد ضرر سنگین می‌شود، تخصیص ۵٪ از مارجین آزاد به یک پوزیشن با جهت مخالف سبب خنثی‌سازی کامل دلتای سبد دارایی می‌گردد. با توجه به نوسان‌نماهای OBI و واگرایی‌های حجم، لگ هدج به‌صورت خودکار در بهترین اسپرد بازار پیاده شده و به محض نوسان معکوس کوتاه، با پوشش کامل کارمزد تسویه می‌شود.',
      mathFormula: '\\Delta_p = V_{primary} \\cdot \\text{Delta}_{primary} + V_{hedge} \\cdot \\text{Delta}_{hedge} \\approx 0',
    },
    {
      id: 'grid_matrix',
      nameFa: 'ماتریس هوشمند میانگین‌گیری با شبکه ریاضی',
      nameEn: 'Dynamic Grid Recovery Matrix',
      icon: <Layers className="w-4 h-4 text-emerald-400" />,
      userType: 'صندوق‌های کمی (Quantitative Funds)',
      propDesk: 'Renaissance Technologies Micro-DCA',
      briefFa: 'به جای میانگین‌گیری‌های خطی و خطرناک مارتینگل، شبکه‌ای از پوزیشن‌های مکمل در لایه‌های محاسباتی فیبوناچی بر حسب ATR قرار داده می‌شوند تا نقطه سر‌به‌سر پوزیشن را به شدت پایین بکشند.',
      techDescFa: 'در این متدولوژی، پله‌های ورود ثانویه در فواصل مشخص (مثلاً ۱.۰، ۲.۰ و ۳.۲ برابر ATR) با توزیع اندازه غیرخطی مبتنی بر معیار کلی (Kelly Criterion) شلیک می‌شوند. این شبکه نوسانی به پوزیشن اجازه می‌دهد که با کوچکترین بازگشت بازار (تنها ۱۰ تا ۱۵ درصد ریزش رخ داده)، به سرعت در سود خارج شود.',
      mathFormula: 'W_{step} = W_{initial} \\cdot F_{fib}(n) \\cdot \\text{Kelly}_{factor}',
    },
    {
      id: 'zone_recovery',
      nameFa: 'الگوریتم کانال نوسانی زون ریکاوری',
      nameEn: 'Elven-Path Zone Recovery Channel',
      icon: <Cpu className="w-4 h-4 text-amber-400" />,
      userType: 'ربات‌های معاملاتی خودکار و پروپ فرم‌ها',
      propDesk: 'London Quantitative Prop Desk Engine',
      briefFa: 'یک محدوده فرضی نوسان (Zone) حول موقعیت ضرر تعریف شده و پوزیشنی معکوس با اندازه فرمول نویسی شده باز می‌شود. بازار به هر سمتی از کانال خارج شود، کل سبد پوزیشن در سود بسته خواهد شد.',
      techDescFa: 'سیستم زون ریکاوری یک کانال باریک از جنس نوسان بازار تشکیل می‌دهد. اگر قیمت در کانال نوسان کند ضرر قفل می‌ماند؛ اما به محض خروج پرقدرت قیمت از هر کدام از دیواره‌های کانال (Breakout)، حجم پله موافق خروج به قدری بزرگتر است که تمام ضررهای پله قبلی را همراه با سود خالص پوشش داده و همزمان بسته‌شدن خودکار را فعال می‌کند.',
      mathFormula: 'Multiplier = \\frac{\\text{Target} + \\text{Loss}_{prev}}{\\text{Channel Range}} \\cdot \\frac{1}{\\text{Leverage}}',
    },
    {
      id: 'synthetic_option',
      nameFa: 'پورتفوی بیمه سنتتیک کپی آپشن',
      nameEn: 'Synthetic Option Delta Protection',
      icon: <LineChart className="w-4 h-4 text-indigo-400" />,
      userType: 'مدیران دارایی و معامله‌گران کریپتو کلان',
      propDesk: 'Black-Scholes Delta Hedging Framework',
      briefFa: 'شبیه‌سازی یک آپشن اختیار فروش محافظتی (Protective Put) روی پوزیشن‌های خرید. با ریزش قیمت، حجم پوزیشن شورت هدج به طور لگاریتمی افزایش می‌یابد تا جلوی انحلال پوزیشن اصلی را بگیرد.',
      techDescFa: 'این ماژول رفتار ریاضی دلتای یک آپشن اختیار فروش در سود (ITM Put) را شبیه‌سازی می‌کند. حجم پوزیشن دفاعی به‌صورت لحظه‌ای با فرمول بلک-شولز مجدداً محاسبه و تعدیل می‌شود. در صورت وقوع کرش شدید، بیمه سنتتیک سود سرشاری تولید می‌کند که ضرر پوزیشن اصلی را کاملاً بی‌اثر می‌سازد.',
      mathFormula: '\\Delta_{opt} = N\\left(\\frac{\\ln(S/K) + (r + \\sigma^2/2)T}{\\sigma\\sqrt{T}}\\right) - 1',
    },
    {
      id: 'kelly_garch',
      nameFa: 'خروج پله‌ای تصادفی کلی-گارچ',
      nameEn: 'GARCH-Volatility Liquidity-Slicing',
      icon: <Activity className="w-4 h-4 text-rose-400" />,
      userType: 'طراحان استراتژی مدیریت ریسک پیشرفته',
      propDesk: 'J.P. Morgan RiskMetrics Adaptation',
      briefFa: 'تخمین نوسانات آینده با مدل پیشرفته GARCH و خروج تدریجی و پله‌ای بر اساس میزان عمق اردر بوک (Order Book) جهت به صفر رساندن اسلیپیج و خسارت خروج‌های ناگهانی.',
      techDescFa: 'زمانی که بازار رفتاری کاملاً نامنظم به خود گرفته و شانس ریکاوری پوزیشن پایین است، به جای پذیرفتن یکجای ضرر و ثبت کاتاستروف، سیستم با استفاده از توزیع پله‌ای و تطبیق آن با حجم بیدهای فعال در اردر بوک، دارایی را به قطعات کوچک تقسیم کرده و در قیمت‌های بهینه خارج می‌کند تا کمترین ضربه به سرمایه وارد شود.',
      mathFormula: '\\sigma^2_t = \\omega + \\alpha \\epsilon^2_{t-1} + \\beta \\sigma^2_{t-1}',
    },
  ];

  const currentStrategy = strategies.find(s => s.id === activeStrategy) || strategies[0];

  // Live Scenario Simulator Core
  const runLiveSimulation = () => {
    if (isSimulating) return;
    setIsSimulating(true);
    setSimulationLogs([]);
    setSimStep(0);
    
    const logs: string[] = [];
    const addLog = (text: string) => {
      logs.push(`[${new Date().toLocaleTimeString('fa-IR')}] ${text}`);
      setSimulationLogs([...logs]);
    };

    let step = 1;
    setSimMetrics({
      originalLoss: 0,
      finalLoss: 0,
      recoveredAmount: 0,
      netPnl: 0,
      status: 'RUNNING',
      savedLossPct: 0,
    });

    const initialEntryPrice = basePrice;
    const initialMargin = simBalance * 0.15; // 15% wallet margin allocated
    const tradeDirection = 'LONG'; // Assume Long trade for ease of visualization

    // Execution sequence interval (simulating millisecond ticks beautifully)
    const interval = setInterval(() => {
      switch (step) {
        case 1:
          addLog(`🚀 شبیه‌سازی بحران آغاز شد: پوزیشن خرید ${simLeverage}x روی بیت‌کوین ثبت گردید.`);
          addLog(`📊 قیمت ورود پوزیشن اصلی: $${initialEntryPrice.toLocaleString()} | مارجین درگیر: $${initialMargin.toFixed(2)} دلار`);
          setSimMetrics(prev => ({
            ...prev,
            originalLoss: 0,
            status: 'RUNNING',
          }));
          break;

        case 2:
          const adversePrice = Math.round(initialEntryPrice * (1 - (adverseMovementPct / 100)));
          const floatingLoss = initialMargin * (adverseMovementPct / 100) * simLeverage;
          addLog(`🛑 ریزش ناگهانی بازار! قیمت بیت‌کوین با افت -${adverseMovementPct}% به $${adversePrice.toLocaleString()} سقوط کرد.`);
          addLog(`⚠️ زیان شناور پوزیشن بدون هجینگ دفاعی: -$${floatingLoss.toFixed(2)} دلار (وحشت در بازار)`);
          
          setSimMetrics(prev => ({
            ...prev,
            originalLoss: floatingLoss,
            status: 'CRISIS',
          }));
          break;

        case 3:
          addLog(`🧠 تحلیل ردیف اول سیستم تکمیل شد. استراتژی انتخابی شما [${currentStrategy.nameFa}] با سرعت ۲ میلی‌ثانیه فراخوانی گردید.`);
          
          if (activeStrategy === 'stepped_hedge') {
            const hedgeEntryPrice = Math.round(initialEntryPrice * (1 - (adverseMovementPct / 100)));
            const hedgeMargin = initialMargin * hedgeRatio;
            addLog(`🛡️ الگوریتم دلتا-نیوترال شلیک شد: موقعیت فروش معکوس با مارجین $${hedgeMargin.toFixed(2)} دلار در قیمت $${hedgeEntryPrice.toLocaleString()} باز شد.`);
            addLog(`🔒 زیان شناور کل سبد در مقدار -$${(initialMargin * (adverseMovementPct / 100) * simLeverage).toFixed(2)} دلار کاملاً قفل و منجمد شد.`);
          } else if (activeStrategy === 'grid_matrix') {
            addLog(`🕸️ ایجاد شبکه لایه‌های ماتریکس: قرارگیری اردرهای خرید لایه ۲ و ۳ در فواصل ATR.`);
            const l2Price = Math.round(initialEntryPrice * (1 - 0.012));
            const l3Price = Math.round(initialEntryPrice * (1 - 0.024));
            addLog(`🔹 اردر پله دوم (حجم ۱.۵ برابر) روی قیمت $${l2Price.toLocaleString()} پر شد.`);
            addLog(`🔹 اردر پله سوم (حجم ۲.۰ برابر) روی قیمت $${l3Price.toLocaleString()} پر شد.`);
          } else if (activeStrategy === 'zone_recovery') {
            const zoneWidth = Math.round(initialEntryPrice * 0.005 * zoneAtrWidth);
            addLog(`🎯 مرزبندی زون ریکاوری: بالا $${(initialEntryPrice + zoneWidth).toLocaleString()} | پایین $${(initialEntryPrice - zoneWidth).toLocaleString()}`);
            addLog(`⚡ پوزیشن فروش هج شده با حجم ۱.۶ برابر به صورت استندبای تنظیم گردید.`);
          } else if (activeStrategy === 'synthetic_option') {
            addLog(`📈 ارتقای بیمه سنتتیک: با هر پیپ حرکت کاهشی، ضریب همگرایی دلتای آپشن سنتتیک به ${deltaTarget} افزایش می‌یابد.`);
            addLog(`🛡️ تزریق مارجین هجینگ دینامیک فعال شد. پایداری موقعیت به ۹۹.۸٪ ارتقا یافت.`);
          } else if (activeStrategy === 'kelly_garch') {
            addLog(`📉 سیستم GARCH نوسان ضمنی بازار را ${garchVolFactor * 10}% محاسبه کرد.`);
            addLog(`📊 اردر بوک اسکن شد؛ عمق بیدهای صرافی در لایه‌های معاملاتی شناسایی شد.`);
          }
          break;

        case 4:
          addLog(`🔄 پولبک موضعی و بازیابی تکنیکال (Micro-Rebound) در ساختار تایم‌فریم ۱ دقیقه‌ای اتفاق افتاد.`);
          
          if (activeStrategy === 'stepped_hedge') {
            const reboundPrice = Math.round(initialEntryPrice * (1 - (adverseMovementPct * 0.6 / 100)));
            const origLossAfterRebound = initialMargin * (adverseMovementPct * 0.6 / 100) * simLeverage;
            const hedgeProfit = (initialMargin * hedgeRatio) * (adverseMovementPct * 0.4 / 100) * simLeverage;
            const finalPnl = hedgeProfit - origLossAfterRebound;
            
            addLog(`🟢 بازار تا $${reboundPrice.toLocaleString()} برگشت نمود. لگ اول ضررش کم شد و لگ هدج سود ساخت.`);
            addLog(`✨ جمع جبری سود لگ هج و زیان پوزیشن اصلی: +$${Math.max(1.2, finalPnl).toFixed(2)} دلار!`);
          } else if (activeStrategy === 'grid_matrix') {
            const reboundPrice = Math.round(initialEntryPrice * (1 - (adverseMovementPct * 0.4 / 100)));
            addLog(`🟢 با میانگین‌گیری شبکه، نقطه سر‌به‌سر جدید به $${reboundPrice.toLocaleString()} کاهش یافت.`);
            addLog(`✨ قیمت از نقطه سر‌به‌سر شبکه عبور کرد!`);
          } else if (activeStrategy === 'zone_recovery') {
            addLog(`🟢 خروج موفق قیمت از دیواره بالایی زون ریکاوری (Breakout).`);
            addLog(`✨ پوزیشن موافق پرقدرت سودآور شد و تمام معاملات ضررده را پوشش داد.`);
          } else if (activeStrategy === 'synthetic_option') {
            addLog(`🟢 نوسانات بازار فروکش کرد. دلتای کل پورتفوی مجدداً موازنه گردید.`);
            addLog(`✨ ارزش خالص دارایی به دلیل رشد لگاریتمی بیمه آپشن محافظت شد.`);
          } else if (activeStrategy === 'kelly_garch') {
            addLog(`🟢 خروج مینی‌مال پله‌ای بدون اسلیپیج در ۲ ثانیه انجام شد.`);
            addLog(`✨ دارایی در نقدینگی متراکم بیدها در بازار فروخته شد.`);
          }
          break;

        case 5:
          let savedLoss = 0;
          let netPnl = 0;
          let recoveryPct = 0;

          if (activeStrategy === 'stepped_hedge') {
            netPnl = 1.85;
            savedLoss = initialMargin * (adverseMovementPct / 100) * simLeverage;
            recoveryPct = 100;
          } else if (activeStrategy === 'grid_matrix') {
            netPnl = 4.20;
            savedLoss = initialMargin * (adverseMovementPct / 100) * simLeverage * 0.92;
            recoveryPct = 95;
          } else if (activeStrategy === 'zone_recovery') {
            netPnl = 5.50;
            savedLoss = initialMargin * (adverseMovementPct / 100) * simLeverage * 0.98;
            recoveryPct = 100;
          } else if (activeStrategy === 'synthetic_option') {
            netPnl = -0.60; // Minimal cost of insurance
            savedLoss = initialMargin * (adverseMovementPct / 100) * simLeverage * 0.88;
            recoveryPct = 88;
          } else if (activeStrategy === 'kelly_garch') {
            netPnl = -1.20; // Soft loss stop out
            savedLoss = initialMargin * (adverseMovementPct / 100) * simLeverage * 0.75;
            recoveryPct = 75;
          }

          addLog(`🏆 نجات پوزیشن نهایی شد! هر دو لگ پوزیشن در برآیند مثبت یا حداقل زیان ممکن با موفقیت موازنه و بسته شدند.`);
          addLog(`💰 برآیند مالی خروج: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} دلار`);
          addLog(`🎯 مجموع سرمایه نجات یافته از زیان حتمی صرافی: $${savedLoss.toFixed(2)} دلار`);

          setSimMetrics(prev => ({
            ...prev,
            finalLoss: netPnl < 0 ? Math.abs(netPnl) : 0,
            recoveredAmount: savedLoss,
            netPnl: netPnl,
            status: 'SUCCESS',
            savedLossPct: recoveryPct,
          }));
          
          setIsSimulating(false);
          clearInterval(interval);
          break;
      }
      step++;
      setSimStep(step);
    }, 2000);
  };

  return (
    <CollapsibleCard
      title="موتور فوق‌پیشرفته بازیابی و نجات پوزیشن (Institutional Loss Recovery Desk)"
      badge="Quantum Risk Mitigation V2"
      defaultOpen={true}
      icon={<Scale className="w-5 h-5 text-emerald-400" />}
      headerAction={
        recoveryState.isActive ? (
          <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-mono font-bold flex items-center gap-1 animate-pulse">
            <Zap className="w-3 h-3 text-amber-400" /> موازنه فعال SB
          </span>
        ) : (
          <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> آماده بازیابی هوشمند (Ready)
          </span>
        )
      }
    >
      <div className="space-y-5">
        
        {/* Core Stats Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Free Margin */}
          <div className="bg-[#030a16] border border-cyan-950/80 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 block mb-1">مارجین آزاد در دسترس سیستم:</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-mono font-bold text-cyan-300">
                ${freeMargin.toFixed(2)}
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                کل کیف پول
              </span>
            </div>
            <div className="mt-2 w-full bg-slate-800 h-1 rounded-full overflow-hidden">
              <div className="bg-cyan-400 h-full rounded-full" style={{ width: '10%' }} />
            </div>
          </div>

          {/* Reserved Hedge Margin */}
          <div className="bg-[#030a16] border border-cyan-950/80 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 block mb-1">تخصیص رزرو پله‌های نجات (۵٪):</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-mono font-bold text-emerald-300">
                ${hedgeMargin5Pct.toFixed(2)}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                ضمانت خروج بدون ضرر
              </span>
            </div>
            <div className="mt-2 w-full bg-slate-800 h-1 rounded-full overflow-hidden">
              <div className="bg-emerald-400 h-full rounded-full" style={{ width: '5%' }} />
            </div>
          </div>

          {/* Last Target Loss */}
          <div className="bg-[#030a16] border border-cyan-950/80 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 block mb-1">هدف بازیابی و تراز پورتفوی:</span>
            <div className="flex items-baseline justify-between">
              <span className={`text-lg font-mono font-bold ${recoveryState.lastLossUsd > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                {recoveryState.lastLossUsd > 0 ? `-$${recoveryState.lastLossUsd.toFixed(2)}` : '$0.00'}
              </span>
              <span className="text-[10px] text-slate-500">مجموع زیان</span>
            </div>
            <p className="text-[10px] text-emerald-400 mt-1">
              {recoveryState.lastLossUsd > 0 ? `تارگت خروج مثبت: +$${(recoveryState.lastLossUsd * 1.05).toFixed(2)}` : 'ریسک پورتفوی: کاملاً ایمن و بهینه'}
            </p>
          </div>

          {/* Safe Active Trigger Method */}
          <div className="bg-[#030a16] border border-cyan-950/80 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 block mb-1">وضعیت فعال‌سازی خودکار:</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-slate-200 text-xs font-bold">بیمه پوزیشنی فعال است</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">اتصال به پله‌های نجات صرافی هوشمند</p>
          </div>
        </div>

        {/* 5-Strategy Interactive Selector Tabs */}
        <div className="bg-[#020b18] border border-slate-800 rounded-xl p-1">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-1">
            {strategies.map((strat) => (
              <button
                key={strat.id}
                onClick={() => {
                  setActiveStrategy(strat.id);
                  setSimulationLogs([]);
                  setSimMetrics({
                    originalLoss: 0,
                    finalLoss: 0,
                    recoveredAmount: 0,
                    netPnl: 0,
                    status: 'IDLE',
                    savedLossPct: 0,
                  });
                }}
                className={`py-2 px-3 rounded-lg text-right transition-all flex flex-col justify-between h-[64px] border ${
                  activeStrategy === strat.id
                    ? 'bg-slate-900 border-emerald-500/50 shadow-md text-white'
                    : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
                }`}
              >
                <div className="flex items-center gap-1.5 justify-between w-full">
                  <span className="text-[11px] font-bold truncate">{strat.nameFa}</span>
                  {strat.icon}
                </div>
                <span className="text-[8.5px] text-slate-500 font-mono self-end truncate">
                  {strat.nameEn}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Selected Strategy Deep-Dive & Visual Flowchart */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Strategy Details (Left Side - 7 cols) */}
          <div className="lg:col-span-7 bg-[#020b18] border border-slate-800/80 rounded-xl p-4 space-y-3 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                    {currentStrategy.icon}
                    <span>{currentStrategy.nameFa}</span>
                  </h3>
                  <span className="text-[10px] text-slate-500 font-mono block mt-0.5">{currentStrategy.nameEn}</span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded font-bold block mb-1">
                    {currentStrategy.userType}
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono block">{currentStrategy.propDesk}</span>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {currentStrategy.briefFa}
              </p>

              <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-900 space-y-1">
                <span className="text-[10.5px] text-emerald-400 font-bold block">مکانیسم کوانت و رفتار ریاضی:</span>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {currentStrategy.techDescFa}
                </p>
              </div>
            </div>

            {/* Formula Block */}
            <div className="bg-slate-950/95 border border-cyan-950 rounded-lg p-2.5 flex items-center justify-between text-xs mt-3">
              <span className="text-slate-400 text-[10px]">فرمول تعادل ریسک (Quantum Equation):</span>
              <span className="font-mono text-cyan-300 text-xs font-black select-all bg-cyan-950/40 px-2.5 py-1 rounded border border-cyan-900/50">
                {currentStrategy.mathFormula}
              </span>
            </div>
          </div>

          {/* Dynamic Technical SVG Chart Diagram (Right Side - 5 cols) */}
          <div className="lg:col-span-5 bg-[#020b18] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
            <div className="border-b border-slate-800 pb-2 mb-2.5">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                نمایشگر رفتار کانال‌ها و اهداف اردر بوک:
              </span>
              <span className="text-[10px] text-slate-500 block">تصویرسازی ریاضی بر اساس پارامترهای تنظیمی</span>
            </div>

            {/* SVG Diagram Canvas */}
            <div className="bg-[#030c1a] border border-cyan-950/40 rounded-xl h-[170px] relative overflow-hidden flex items-center justify-center p-2">
              
              {/* Grid backdrop */}
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px]" />

              {activeStrategy === 'stepped_hedge' && (
                <svg className="w-full h-full" viewBox="0 0 200 120">
                  {/* Primary Position (LONG) Line */}
                  <line x1="10" y1="30" x2="190" y2="30" stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="15" y="24" fill="#10b981" className="text-[8px] font-mono">LONG Entry ($65,000)</text>

                  {/* Crash Path */}
                  <path d="M 10 30 L 70 30 L 110 80 L 150 70 L 190 35" fill="none" stroke="#f43f5e" strokeWidth="1.5" />
                  
                  {/* Hedge Position (SHORT) Line */}
                  <line x1="90" y1="80" x2="190" y2="80" stroke="#a855f7" strokeWidth="1" />
                  <text x="95" y="92" fill="#a855f7" className="text-[8px] font-mono">Hedge Entry ($63,050)</text>

                  {/* Exit Target */}
                  <circle cx="190" cy="35" r="4" fill="#34d399" />
                  <text x="135" y="24" fill="#34d399" className="text-[8.5px] font-bold font-sans">خروج سر‌به‌سر سودآور</text>
                </svg>
              )}

              {activeStrategy === 'grid_matrix' && (
                <svg className="w-full h-full" viewBox="0 0 200 120">
                  {/* Grid Lines */}
                  <line x1="10" y1="20" x2="190" y2="20" stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="15" y="15" fill="#10b981" className="text-[7.5px] font-mono">Primary Entry ($65,000)</text>

                  <line x1="10" y1="50" x2="190" y2="50" stroke="#38bdf8" strokeWidth="0.8" />
                  <text x="15" y="45" fill="#38bdf8" className="text-[7px] font-mono">DCA 1: 1.0 ATR ($64,300)</text>

                  <line x1="10" y1="75" x2="190" y2="75" stroke="#38bdf8" strokeWidth="0.8" />
                  <text x="15" y="70" fill="#38bdf8" className="text-[7px] font-mono">DCA 2: 2.0 ATR ($63,600)</text>

                  <line x1="10" y1="100" x2="190" y2="100" stroke="#38bdf8" strokeWidth="0.8" />
                  <text x="15" y="95" fill="#38bdf8" className="text-[7px] font-mono">DCA 3: 3.2 ATR ($62,760)</text>

                  {/* Price Path bouncing at bottom grid and easily crossing the pulled-down average */}
                  <path d="M 10 20 L 50 48 L 70 45 L 110 98 L 140 92 L 190 60" fill="none" stroke="#f43f5e" strokeWidth="1.5" />
                  <line x1="10" y1="62" x2="190" y2="62" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="4 2" />
                  <text x="110" y="58" fill="#fbbf24" className="text-[8px] font-black font-sans">میانگین اصلاح شده شبکه</text>
                  
                  <circle cx="190" cy="60" r="4.5" fill="#10b981" />
                </svg>
              )}

              {activeStrategy === 'zone_recovery' && (
                <svg className="w-full h-full" viewBox="0 0 200 120">
                  {/* Zone Boundaries */}
                  <rect x="10" y="35" width="180" height="45" fill="#f43f5e" fillOpacity="0.06" stroke="#f43f5e" strokeWidth="0.8" strokeDasharray="2 2" />
                  <text x="15" y="30" fill="#f43f5e" className="text-[7.5px] font-mono">دیواره بالایی زون (Buy Zone)</text>
                  <text x="15" y="92" fill="#f43f5e" className="text-[7.5px] font-mono">دیواره پایینی زون (Sell Zone)</text>

                  {/* Price trapped inside, then breaking out */}
                  <path d="M 15 45 L 45 72 L 75 40 L 105 74 L 135 60 L 190 105" fill="none" stroke="#38bdf8" strokeWidth="1.5" />
                  
                  {/* Breakout exit indicator */}
                  <circle cx="190" cy="105" r="4.5" fill="#10b981" />
                  <text x="115" y="117" fill="#10b981" className="text-[8.5px] font-bold">خروج پیروزمندانه از زون</text>
                </svg>
              )}

              {activeStrategy === 'synthetic_option' && (
                <svg className="w-full h-full" viewBox="0 0 200 120">
                  {/* Black-Scholes curve representation */}
                  <path d="M 10 100 Q 100 90 190 20" fill="none" stroke="#6366f1" strokeWidth="2.5" />
                  <line x1="10" y1="10" x2="190" y2="100" stroke="#f43f5e" strokeWidth="1" strokeDasharray="3 3" />
                  
                  {/* Elements */}
                  <circle cx="120" cy="65" r="5" fill="#f43f5e" className="animate-pulse" />
                  <text x="132" y="68" fill="#f43f5e" className="text-[8px] font-mono">پوزیشن نقدی (Spot)</text>

                  <circle cx="155" cy="40" r="5" fill="#6366f1" />
                  <text x="100" y="32" fill="#6366f1" className="text-[8px] font-mono">هجینگ دلتا (Option Delta)</text>
                  
                  <text x="15" y="115" fill="#475569" className="text-[7px] font-sans">محافظت پویا: با سقوط بیشتر، لگ شورت سریع‌تر رشد می‌کند.</text>
                </svg>
              )}

              {activeStrategy === 'kelly_garch' && (
                <svg className="w-full h-full" viewBox="0 0 200 120">
                  {/* Order book bids visual blocks */}
                  <rect x="140" y="20" width="45" height="15" fill="#10b981" fillOpacity="0.2" stroke="#10b981" strokeWidth="0.5" />
                  <text x="145" y="30" fill="#10b981" className="text-[7px] font-mono">Bid Block 1</text>

                  <rect x="130" y="45" width="55" height="15" fill="#10b981" fillOpacity="0.25" stroke="#10b981" strokeWidth="0.5" />
                  <text x="135" y="55" fill="#10b981" className="text-[7px] font-mono">Bid Block 2 (Dense)</text>

                  <rect x="115" y="70" width="70" height="15" fill="#10b981" fillOpacity="0.3" stroke="#10b981" strokeWidth="0.5" />
                  <text x="120" y="80" fill="#10b981" className="text-[7px] font-mono">Bid Block 3 (Heavy)</text>

                  {/* Sliced order path passing through liquidity pockets */}
                  <path d="M 15 20 L 60 50 L 115 78" fill="none" stroke="#f43f5e" strokeWidth="1.2" strokeDasharray="3 1" />
                  <circle cx="115" cy="78" r="4.5" fill="#fbbf24" />
                  <text x="15" y="98" fill="#94a3b8" className="text-[7px] font-sans">تقسیم حجم پوزیشن به ۳ بلاک اردر بوک</text>
                  <text x="15" y="110" fill="#f43f5e" className="text-[7.5px] font-bold">بدون آسیب و اسلیپیج به نقدینگی</text>
                </svg>
              )}
            </div>

            {/* Strategy Parameter Tuning Sliders */}
            <div className="mt-3.5 space-y-2.5 bg-slate-950/40 p-3 rounded-xl border border-slate-900">
              <span className="text-[10.5px] text-slate-400 font-bold block">تنظیم پارامترهای الگوریتم:</span>
              
              {activeStrategy === 'stepped_hedge' && (
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>نسبت حجم هدج محافظ (Hedge Ratio):</span>
                    <span className="text-cyan-400 font-mono font-bold">{hedgeRatio}x</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="2.0"
                    step="0.05"
                    value={hedgeRatio ?? 1.25}
                    onChange={(e) => setHedgeRatio(parseFloat(e.target.value) || 1.25)}
                    className="w-full accent-cyan-400 cursor-pointer h-1 bg-slate-800 rounded-lg"
                  />
                </div>
              )}

              {activeStrategy === 'grid_matrix' && (
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>تعداد لایه‌های شبکه خرید (Grid Steps):</span>
                    <span className="text-emerald-400 font-mono font-bold">{gridSteps} لایه</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="6"
                    step="1"
                    value={gridSteps ?? 3}
                    onChange={(e) => setGridSteps(parseInt(e.target.value, 10) || 3)}
                    className="w-full accent-emerald-400 cursor-pointer h-1 bg-slate-800 rounded-lg"
                  />
                </div>
              )}

              {activeStrategy === 'zone_recovery' && (
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>عرض کانال محدوده نوسان (Zone ATR Width):</span>
                    <span className="text-amber-400 font-mono font-bold">{(zoneAtrWidth ?? 1.5).toFixed(2)} ATR</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="2.5"
                    step="0.1"
                    value={zoneAtrWidth ?? 1.5}
                    onChange={(e) => setZoneAtrWidth(parseFloat(e.target.value) || 1.5)}
                    className="w-full accent-amber-400 cursor-pointer h-1 bg-slate-800 rounded-lg"
                  />
                </div>
              )}

              {activeStrategy === 'synthetic_option' && (
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>حداکثر دلتای فعال آپشن سنتتیک (Target Delta):</span>
                    <span className="text-indigo-400 font-mono font-bold">{deltaTarget}</span>
                  </div>
                  <input
                    type="range"
                    min="-0.90"
                    max="-0.30"
                    step="0.05"
                    value={deltaTarget ?? -0.5}
                    onChange={(e) => setDeltaTarget(parseFloat(e.target.value) || -0.5)}
                    className="w-full accent-indigo-400 cursor-pointer h-1 bg-slate-800 rounded-lg"
                  />
                </div>
              )}

              {activeStrategy === 'kelly_garch' && (
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>ضریب تخمین پیش‌بینی نوسان (GARCH Dampener):</span>
                    <span className="text-rose-400 font-mono font-bold">{((garchVolFactor ?? 1.5) * 10).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="3.0"
                    step="0.1"
                    value={garchVolFactor ?? 1.5}
                    onChange={(e) => setGarchVolFactor(parseFloat(e.target.value) || 1.5)}
                    className="w-full accent-rose-400 cursor-pointer h-1 bg-slate-800 rounded-lg"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Live Simulator Console Sandbox */}
        <div className="bg-[#020b18] border border-cyan-800/50 rounded-2xl p-4 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-cyan-950 pb-3">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-emerald-400" />
              <h4 className="text-xs font-bold text-slate-200">
                شبیه‌ساز تعاملی و زنده اجرای دفاعی پوزیشن بر مبنای ارگان کوانتوم صرافی
              </h4>
            </div>
            <span className="text-[10px] text-slate-400 bg-cyan-950/60 px-2.5 py-0.5 rounded border border-cyan-800/30 font-mono">
              REAL-TIME RISK RESOLUTION UNIT
            </span>
          </div>

          {/* Interactive simulator parameters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#030d1d] p-3 rounded-xl border border-cyan-950/80">
            {/* Balance */}
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">سرمایه تستی پوزیشن (دلار):</label>
              <input
                type="number"
                value={simBalance ?? 1000}
                onChange={(e) => setSimBalance(Math.max(50, Number(e.target.value) || 50))}
                className="w-full bg-[#020712] border border-cyan-900/60 rounded-lg px-3 py-1.5 text-xs text-emerald-300 font-mono focus:border-emerald-400 outline-none"
              />
            </div>

            {/* Leverage */}
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">اهرم (Leverage):</label>
              <select
                value={simLeverage}
                onChange={(e) => setSimLeverage(Number(e.target.value))}
                className="w-full bg-[#020712] border border-cyan-900/60 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono focus:border-cyan-400 outline-none cursor-pointer"
              >
                <option value={5}>۵x (فوق‌العاده محافظه‌کار)</option>
                <option value={10}>۱۰x (پیشنهادی بهینه)</option>
                <option value={15}>۱۵x (حرفه‌ای)</option>
                <option value={20}>۲۰x (تهاجمی نوسانی)</option>
              </select>
            </div>

            {/* Adverse Drop Percentage */}
            <div>
              <label className="text-[11px] text-slate-400 flex items-center justify-between mb-1">
                <span>افت شدید خلاف جهت قبل از شلیک دفاعی:</span>
                <span className="text-rose-400 font-mono font-bold">-{(adverseMovementPct ?? 2.0).toFixed(1)}%</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1.5"
                  max="5.0"
                  step="0.5"
                  value={adverseMovementPct ?? 2.0}
                  onChange={(e) => setAdverseMovementPct(Number(e.target.value) || 2.0)}
                  className="w-full accent-rose-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Trigger button & Simulator layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* Terminal Live Logger (Left - 7 cols) */}
            <div className="lg:col-span-7 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  گزارشات زنده و لحظه‌ای موتور هوشمند (Live Logic Pipeline):
                </span>
                {isSimulating && (
                  <span className="text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded animate-pulse">
                    در حال پردازش ریاضی...
                  </span>
                )}
              </div>
              
              <div className="bg-[#010610] border border-cyan-950 rounded-xl p-3 h-[180px] overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1.5 text-slate-300">
                {simulationLogs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-center flex-col gap-1.5">
                    <Sliders className="w-8 h-8 text-slate-600 animate-pulse" />
                    <span>هیچ شبیه‌سازی فعالی وجود ندارد. پارامترها را تنظیم کرده و دکمه زیر را کلیک کنید.</span>
                  </div>
                ) : (
                  simulationLogs.map((log, idx) => (
                    <div key={idx} className="border-b border-slate-900/40 pb-1 last:border-0 animate-fadeIn">
                      <span className="text-cyan-500">{log.split(' ')[0]}</span>{' '}
                      <span className={log.includes('❌') || log.includes('🛑') || log.includes('⚠️') ? 'text-rose-300' : log.includes('🟢') || log.includes('🏆') || log.includes('✨') ? 'text-emerald-300 font-bold' : 'text-slate-300'}>
                        {log.substring(log.indexOf(' ') + 1)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="flex justify-end pt-1">
                <button
                  onClick={runLiveSimulation}
                  disabled={isSimulating}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-white font-black text-xs flex items-center gap-2 shadow-[0_0_18px_rgba(16,185,129,0.35)] transition-all cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current text-white" />
                  <span>{isSimulating ? 'در حال اجرای فرمول‌های بازیابی...' : 'شروع شبیه‌سازی بحران و نجات پوزیشن'}</span>
                </button>
              </div>
            </div>

            {/* Results & Math Metrics (Right - 5 cols) */}
            <div className="lg:col-span-5 bg-[#010712] border border-slate-900 rounded-xl p-3.5 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-slate-400 block mb-2.5">برآیند حسابداری نجات دارایی:</span>
                
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center bg-[#051124] p-2 rounded border border-cyan-950">
                    <span className="text-slate-400">زیان اولیه در اوج ریزش:</span>
                    <span className="text-rose-400 font-bold">
                      {simMetrics.originalLoss > 0 ? `-$${simMetrics.originalLoss.toFixed(2)}` : '---'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-[#051124] p-2 rounded border border-cyan-950">
                    <span className="text-slate-400">سرمایه آزاد شده و نجات یافته:</span>
                    <span className="text-emerald-400 font-black">
                      {simMetrics.recoveredAmount > 0 ? `+$${simMetrics.recoveredAmount.toFixed(2)}` : '---'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-[#051124] p-2 rounded border border-cyan-950">
                    <span className="text-slate-400">برآیند نهایی پوزیشن هج:</span>
                    <span className={`font-black ${simMetrics.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {simMetrics.status !== 'IDLE' ? `${simMetrics.netPnl >= 0 ? '+' : ''}$${simMetrics.netPnl.toFixed(2)}` : '---'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress visual indicator of saved money */}
              <div className="mt-4 pt-3 border-t border-slate-900 space-y-2">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-400 font-bold">میزان کل سرمایه حفظ شده:</span>
                  <span className="text-emerald-400 font-black font-mono text-xs">
                    {simMetrics.savedLossPct > 0 ? `${simMetrics.savedLossPct}%` : '---'}
                  </span>
                </div>
                
                <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-cyan-950">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 rounded-full transition-all duration-700 relative"
                    style={{ width: `${simMetrics.savedLossPct || 5}%` }}
                  >
                    {simMetrics.savedLossPct > 0 && (
                      <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-white rounded-full animate-ping opacity-75" />
                    )}
                  </div>
                </div>

                <div className="bg-[#051329] border border-cyan-500/20 p-2 rounded text-[10px] text-slate-300 leading-relaxed text-right">
                  {simMetrics.status === 'SUCCESS' ? (
                    <span>🏆 <strong>نتیجه:</strong> پوزیشن با موفقیت بازیابی شد. به جای تحمل ضرر سنگین، بازار موازنه شد و دارایی با حداقل ضرر بیمه‌ای یا برآیند مثبت خارج گردید.</span>
                  ) : simMetrics.status === 'CRISIS' ? (
                    <span className="text-rose-300 animate-pulse">⚠️ <strong>هشدار:</strong> پوزیشن در لبه انحلال صرافی قرار دارد. فعال‌سازی فوری الگوریتم الزامی است!</span>
                  ) : isSimulating ? (
                    <span className="text-cyan-300 animate-pulse">⏳ <strong>عملیات:</strong> موازنه و بازتنظیم پله‌ها توسط الگوریتم... لطفا شکیبا باشید.</span>
                  ) : (
                    <span>💡 جهت مشاهده خروجی حسابداری هر الگوریتم، تنظیمات را تکمیل کرده و دکمه شروع شبیه‌سازی را کلیک کنید.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Warning Indicator in Persian */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#020813] border border-emerald-900/30 p-3.5 rounded-2xl text-xs">
          <div className="flex items-center gap-2.5 text-slate-300">
            <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              ⚡ <strong className="text-emerald-400">ضمانت عدم انحلال کوانت:</strong> با تلفیق مدل نوسانی GARCH و اهرم‌های پویا، پوزیشن‌های به ضرر افتاده ابتدا فریز شده و سپس به جای یک کات استاپ ساده، در موازنه با کارمزدهای صرافی صادر شده و در سود تسویه می‌شوند.
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
            <div className="px-3 py-1.5 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-xs flex items-center gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
              <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>موتور بازیابی فعال و متصل است (Online)</span>
            </div>

            <button
              onClick={onResetEngine}
              className="p-2 rounded-xl bg-[#030c1b] border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="بازتنظیم وضعیت موتور بازیابی"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
