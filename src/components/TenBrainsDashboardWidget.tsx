import React from 'react';
import { Cpu } from 'lucide-react';
import { CollapsibleCard } from './CollapsibleCard';
import { tenBrainsDashboardService } from '../services/tenBrainsDashboardService';

export const TenBrainsDashboardWidget: React.FC = () => {
  const brains = tenBrainsDashboardService.getTenBrainsRegistry();

  return (
    <CollapsibleCard
      title="فهرست پردازشگرها (تله‌متری متصل نیست)"
      badge="NOT INSTRUMENTED"
      badgeColor="text-amber-300 bg-amber-950/80 border-amber-500/40"
      defaultOpen={true}
      icon={<Cpu className="w-5 h-5 text-amber-400" />}
    >
      <div className="space-y-3 font-sans text-xs">
        <p className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 leading-relaxed text-amber-100">
          این فهرست فقط نام پردازشگرهای تعریف‌شده در رابط کاربری را نشان می‌دهد. اجرای واقعی، سلامت، رأی، latency و احتمال کالیبره‌شده از این نما قابل اندازه‌گیری نیستند.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {brains.map((brain) => (
            <div
              key={brain.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-cyan-950/80 bg-[#041124] p-3"
            >
              <span className="font-bold text-white">
                <span className="mr-2 text-cyan-300">#{brain.id}</span>
                {brain.nameFa}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-slate-500">{brain.codeName}</span>
            </div>
          ))}
        </div>
      </div>
    </CollapsibleCard>
  );
};
