import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  currentPrice?: number;
  entryPrice?: number;
  direction?: 'LONG' | 'SHORT';
  marginUsd?: number;
  leverage?: number;
  onUpdateStop?: (newStopPrice: number) => void;
}

export const TrendSurvivalAndMfeTrailingWidget: React.FC<Props> = () => (
  <section className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4 text-amber-100">
    <div className="flex items-center gap-2 font-semibold">
      <AlertTriangle className="h-4 w-4" />
      تحلیل دوام روند موقتاً غیرفعال است
    </div>
    <p className="mt-2 text-sm text-amber-200/80">
      این پنل تا اتصال و اعتبارسنجی مستقیم RSI، جریان معاملات، دفتر سفارش و دادهٔ MFE هیچ مقدار تخمینی یا شبیه‌سازی‌شده‌ای نمایش نمی‌دهد.
    </p>
  </section>
);
