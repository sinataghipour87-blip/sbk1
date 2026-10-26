import React, { useId, useState } from 'react';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';

interface CollapsibleCardProps {
  title: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
  contentClassName?: string;
}

export const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
  title,
  icon,
  badge,
  badgeColor = 'text-emerald-300 bg-emerald-950/80 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]',
  defaultOpen = true,
  children,
  className = '',
  headerAction,
  contentClassName = 'overflow-y-auto custom-scrollbar',
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);
  const contentId = useId();

  return (
    <div className={`bg-[#030712]/95 border border-emerald-500/35 rounded-2xl shadow-[0_0_30px_rgba(16,185,129,0.08)] overflow-hidden transition-all relative ${className}`}>
      {/* Top Cyber Laser Glow Line */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-emerald-400 via-slate-200 to-transparent shadow-[0_0_12px_#10b981] z-10" />

      {/* Collapsible Header */}
      <div className="w-full flex items-center justify-between gap-2 p-3.5 bg-gradient-to-r from-[#04101e] via-[#030712] to-[#04101e] border-b border-emerald-950/80 select-none relative z-20">
        <h3 className="min-w-0">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={isOpen ? contentId : undefined}
            onClick={() => setIsOpen(!isOpen)}
            className="min-w-0 flex items-center gap-2.5 text-right hover:text-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
          >
            {icon || <Terminal aria-hidden="true" className="w-4 h-4 text-emerald-400 animate-pulse" />}
            <span className="text-xs sm:text-sm font-mono font-bold text-white tracking-wide flex items-center gap-2">
              <span aria-hidden="true" className="text-emerald-400 text-xs shadow-[0_0_6px_#10b981]">◈</span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-100 via-white to-slate-200">{title}</span>
            </span>
            {badge && (
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${badgeColor}`}>
                {badge}
              </span>
            )}
          </button>
        </h3>

        <div className="shrink-0 flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-900/50 text-[9px] font-mono text-emerald-300/80">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>HUD_STREAM</span>
          </div>
          {headerAction}
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={isOpen ? contentId : undefined}
            aria-label={isOpen ? `بستن ${title}` : `باز کردن ${title}`}
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 hover:text-white border border-emerald-800/60 transition-colors cursor-pointer shadow-[0_0_8px_rgba(16,185,129,0.25)]"
          >
            {isOpen ? <ChevronUp aria-hidden="true" className="w-4 h-4 text-emerald-400" /> : <ChevronDown aria-hidden="true" className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>
      </div>

      {/* Card Content Area */}
      {isOpen && <div id={contentId} className={`p-3 sm:p-4 relative z-10 flex-1 min-h-0 flex flex-col ${contentClassName}`}>{children}</div>}
    </div>
  );
};
