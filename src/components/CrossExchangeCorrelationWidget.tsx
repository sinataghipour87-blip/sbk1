import React, { useState, useEffect } from 'react';
import { RefreshCw, Globe, AlertTriangle } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { crossExchangeCorrelationEngine, CrossExchangeAnalysisResult } from '../services/crossExchangeCorrelationEngine';

interface Props {
  currentPrice?: number;
  obi?: number;
  orderSizeUsd?: number;
}

export const CrossExchangeCorrelationWidget: React.FC<Props> = () => {
  const [data, setData] = useState<CrossExchangeAnalysisResult | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      setData(await crossExchangeCorrelationEngine.analyzeRealCrossExchangeMetrics());
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <CollapsibleCard
      title="تحلیل همبستگی و نقدینگی بین‌صرافی"
      badge={data?.available ? 'دادهٔ زنده' : 'ناموجود'}
      badgeColor={data?.available
        ? 'text-cyan-300 bg-cyan-950/80 border border-cyan-500/40'
        : 'text-amber-300 bg-amber-950/80 border border-amber-500/40'}
      defaultOpen={true}
      icon={<Globe className="w-5 h-5 text-cyan-400" />}
      headerAction={
        <button
          onClick={() => void refresh()}
          disabled={isRefreshing}
          className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-mono text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'در حال بررسی...' : 'بررسی دوباره'}</span>
        </button>
      }
    >
      {data?.available ? (
        <div className="space-y-3 font-mono text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
            <div>نقدینگی ۰.۱٪: ${(data.totalGlobalLiquidity0_1pctUsd / 1_000_000).toFixed(1)}M</div>
            <div>اسلیپیج تخمینی: {data.slippageGuardStatus.estimatedSlippagePct}%</div>
            <div>گپ آربیتراژ: ${data.arbitrageGapUsd}</div>
            <div>تعداد فیدها: {data.activeExchangesCount}</div>
          </div>
          <p>{data.slippageGuardStatus.executionGuidanceFa}</p>
          <p>{data.crossExchangeConsensusFa}</p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <p className="font-bold">دادهٔ تجمیعی بین‌صرافی در دسترس نیست.</p>
            <p className="mt-1 text-amber-100/80">
              هنوز برای venueهای دیگر Freqtrade instance و aggregator تنظیم نشده است؛
              همبستگی، نقدینگی و اسلیپیج نمایش داده نمی‌شوند و از دادهٔ ساختگی یا اتصال مستقیم استفاده نمی‌شود.
            </p>
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
};
