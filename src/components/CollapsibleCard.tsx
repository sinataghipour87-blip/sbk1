import React, { useState } from 'react';
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

  return (
    <div className={`bg-[#030712]/95 border border-emerald-500/35 rounded-2xl shadow-[0_0_30px_rgba(16,185,129,0.08)] overflow-hidden transition-all relative ${className}`}>
      {/* Top Cyber Laser Glow Line */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-emerald-400 via-slate-200 to-transparent shadow-[0_0_12px_#10b981] z-10" />

      {/* Collapsible Header */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3.5 bg-gradient-to-r from-[#04101e] via-[#030712] to-[#04101e] border-b border-emerald-950/80 cursor-pointer select-none hover:bg-emerald-950/30 transition-colors relative z-20"
      >
        <div className="flex items-center gap-2.5">
          {icon || <Terminal className="w-4 h-4 text-emerald-400 animate-pulse" />}
          <h3 className="text-xs sm:text-sm font-mono font-bold text-white tracking-wide flex items-center gap-2">
            <span className="text-emerald-400 text-xs shadow-[0_0_6px_#10b981]">◈</span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-100 via-white to-slate-200">{title}</span>
          </h3>
          {badge && (
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${badgeColor}`}>
              {badge}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-900/50 text-[9px] font-mono text-emerald-300/80">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>HUD_STREAM</span>
          </div>
          {headerAction}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 hover:text-white border border-emerald-800/60 transition-colors cursor-pointer shadow-[0_0_8px_rgba(16,185,129,0.25)]"
            title={isOpen ? 'بستن کادر' : 'باز کردن کادر'}
          >
            {isOpen ? <ChevronUp className="w-4 h-4 text-emerald-400" /> : <ChevronDown className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>
      </div>

      {/* Card Content Area */}
      {isOpen && <div className={`p-3 sm:p-4 relative z-10 flex-1 min-h-0 flex flex-col ${contentClassName}`}>{children}</div>}
    </div>
  );
};

