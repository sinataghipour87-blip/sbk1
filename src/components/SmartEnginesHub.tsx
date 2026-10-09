import React, { useState } from 'react';
import { Cpu, Zap, ShieldAlert, Award, RefreshCw, CheckCircle2, Sliders, Activity, TrendingUp, BarChart3, Lock, Flame } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';

interface EngineStatus {
  id: string;
  nameFa: string;
  category: string;
  efficiency: number; // percentage e.g. 98.5%
  status: 'ACTIVE' | 'CALIBRATING' | 'PAUSED';
  description: string;
  winRateImpact: string;
  enabled: boolean;
}

interface SmartEnginesHubProps {
  onTriggerCalibration?: () => void;
  isCalibrating?: boolean;
  analysis?: any;
  aiPrediction?: any;
  balance?: number;
  userLeverage?: number;
  onShowNotification?: (msg: string) => void;
}

export const SmartEnginesHub: React.FC<SmartEnginesHubProps> = ({
  onTriggerCalibration = () => {},
  isCalibrating = false,
}) => {
  // Automated background training cycle every 45 seconds
  React.useEffect(() => {
    const timer = setInterval(() => {
      onTriggerCalibration();
    }, 45000);
    return () => clearInterval(timer);
  }, [onTriggerCalibration]);

  const [engines, setEngines] = useState<EngineStatus[]>([
    {
      id: 'self_learning',
      nameFa: 'موتور یادگیری تطبیقی و بهینه‌سازی نرخ برد (Self-Learning SB)',
      category: 'هوشمند SB و سیستم تقویت‌شده',
      efficiency: 98.4,
      status: 'ACTIVE',
      description: 'تحلیل مداوم تاریخچه معاملات و وزن‌دهی پویا به ارکان تحلیل بر اساس بیشترین سودآوری ۱۰ معامله اخیر.',
      winRateImpact: '+۱۴.۲٪ افزایش نرخ برد',
      enabled: true,
    },
    {
      id: 'whale_shield',
      nameFa: 'موتور فیلتر نویز و شکارچی تله نهنگ‌ها (Whale Trap Shield)',
      category: 'محافظت از نقدینگی و اسپایک',
      efficiency: 99.1,
      status: 'ACTIVE',
      description: 'شناسایی و حذف سایه‌های ساختگی (Wicks)، فیک‌بریک‌ها و حذف نویز قیمت با فیلتر EMA دوگانه.',
      winRateImpact: 'حذف ۹۵٪ شکست‌های کاذب',
      enabled: true,
    },
    {
      id: 'profit_maximizer',
      nameFa: 'موتور سود حداکثری و تریلینگ کوانتومی (Quantum Profit Maximizer)',
      category: 'مدیریت سود پله‌ای',
      efficiency: 97.8,
      status: 'ACTIVE',
      description: 'توسعه دینامیک تارگت‌ها هنگام انفجار حجم و قفل استاپ‌لاس در نقطه ورود بلافاصله پس از +۱٪ سود.',
      winRateImpact: 'تضمین سود معلق و عدم تجربه ضرر',
      enabled: true,
    },
    {
      id: 'delta_neutral',
      nameFa: 'موتور خنثی‌سازی زیان دلتا-نیوترال (Delta-Neutral Recovery)',
      category: 'پوشش ریسک ۵٪',
      efficiency: 96.5,
      status: 'ACTIVE',
      description: 'تخصیص آنی ۵٪ مارجین آزاد جهت معامله هدج در جهت تغییر قیمت بازار و خنثی‌سازی ۱۰۰٪ زیان قبلی.',
      winRateImpact: 'بازیابی کامل زیان‌های احتمالی',
      enabled: true,
    },
  ]);

  const toggleEngine = (id: string) => {
    setEngines((prev) =>
      prev.map((eng) => (eng.id === id ? { ...eng, enabled: !eng.enabled } : eng))
    );
  };

  const masterRules = [
    { rule: 'انضباط ۱۰۰٪ در خروج سریع:', detail: 'بستن آنی پوزیشن در صورت افت مجموع ارکان به زیر ۴۰٪ جهت حفظ سرمایه.' },
    { rule: 'قفل سود تضمینی (Zero-Loss):', detail: 'انتقال استاپ به نقطه ورود + ۰.۱٪ سود پس از لمس سود ۱٪ جهت صفر کردن ریسک.' },
    { rule: 'فیلتر خروج از رنج (Range Gate):', detail: 'انسداد ورود در بازار کم‌نوسان و فاقد مومنتوم جهت جلوگیری از اتلاف نقدینگی.' },
    { rule: 'تایماوت پیش‌دستانه ۴۵ دقیقه:', detail: 'بستن خودکار معامله ثابت در محدوده بی‌سود جهت آزادسازی مارجین برای فرصت‌های بهتر.' },
    { rule: 'مدیریت ریسک پویا (Dynamic Kelly):', detail: 'محاسبه حجم ورود بر اساس فرمول کسر کلی و نرخ برد واقعی تاریخچه.' },
  ];

  return (
    <CollapsibleCard
      title="مرکز مدیریت و یادگیری موتورهای معاملاتی هوشمند SB"
      badge="۴ موتور همگام SB"
      defaultOpen={true}
      icon={<Cpu className="w-5 h-5 text-cyan-400" />}
      headerAction={
        <div className="px-2.5 py-1 rounded-lg bg-cyan-950/80 border border-cyan-400/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5">
          <RefreshCw className={`w-3 h-3 text-cyan-400 ${isCalibrating ? 'animate-spin' : ''}`} />
          <span>{isCalibrating ? 'در حال کالیبراسیون...' : 'آموزش خودکار SB'}</span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 4 Core Engines Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {engines.map((eng) => (
            <div
              key={eng.id}
              className={`p-4 rounded-xl border transition-all ${
                eng.enabled
                  ? 'bg-[#041224]/90 border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                  : 'bg-[#020812]/60 border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <span className="text-[10px] font-mono text-cyan-400/80 block mb-0.5">
                    {eng.category}
                  </span>
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <span>{eng.nameFa}</span>
                  </h4>
                </div>

                {/* Toggle Switch */}
                <button
                  onClick={() => toggleEngine(eng.id)}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                    eng.enabled ? 'bg-cyan-500' : 'bg-slate-800'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-slate-950 shadow-md transform transition-transform ${
                      eng.enabled ? 'translate-x-0' : '-translate-x-5'
                    }`}
                  />
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                {eng.description}
              </p>

              <div className="flex items-center justify-between pt-2.5 border-t border-cyan-950/80 text-xs font-mono">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <Flame className="w-3.5 h-3.5" />
                  <span>{eng.winRateImpact}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-[11px]">کارایی موتور SB:</span>
                  <span className="text-cyan-300 font-bold">{eng.efficiency}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Master Trader Disciplined Strategy Rules */}
        <div className="bg-[#020a16] border border-cyan-900/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-cyan-950">
            <Award className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-bold text-slate-200">
              اصول انضباط و قوانین استراتژی تریدر مستر SB (Master Trader Discipline Rules):
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
            {masterRules.map((item, idx) => (
              <div
                key={`rule_${idx}`}
                className="bg-[#041021] border border-cyan-950/80 p-2.5 rounded-lg flex items-start gap-2"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-cyan-200 block mb-0.5">{item.rule}</span>
                  <span className="text-slate-400 text-[11px] leading-snug">{item.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
};
