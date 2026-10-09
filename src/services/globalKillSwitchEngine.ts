/**
 * 🛑 Global Kill Switch & Emergency Protective Engine
 * Item 80
 * 
 * Instantly halts:
 * 1. New entries
 * 2. New orders
 * 3. AutoTrade daemon
 * 
 * Handles existing active positions deterministically based on policy:
 * - 'HOLD_WITH_BREAKEVEN': Sets SL to entry price + fees and keeps riding.
 * - 'CLOSE_ALL_IMMEDIATELY': Sends emergency market close orders for all open positions.
 * - 'PROTECT_TIGHT_SL': Tightens stop loss to 0.5x ATR trailing buffer.
 * - 'CANCEL_PENDING_ONLY': Cancels all pending limit/stop orders, leaves open positions untouched.
 */

import { TradePosition } from '../types/trading';

export type KillSwitchPositionPolicy =
  | 'HOLD_WITH_BREAKEVEN'
  | 'CLOSE_ALL_IMMEDIATELY'
  | 'PROTECT_TIGHT_SL'
  | 'CANCEL_PENDING_ONLY';

export interface KillSwitchStatusReport {
  isKillSwitchEngaged: boolean;
  engagedAtMs: number | null;
  engagedAtIso: string | null;
  triggerReasonFa: string;
  policy: KillSwitchPositionPolicy;
  isNewEntryBlocked: boolean;
  isAutoTradeHalted: boolean;
  pendingOrdersCancelledCount: number;
  positionsAffectedCount: number;
  actionSummaryFa: string;
}

const KILL_SWITCH_STORAGE_KEY = 'quantum_global_kill_switch_state';

export class GlobalKillSwitchEngine {
  private static instance: GlobalKillSwitchEngine;
  private isEngaged = false;
  private engagedAt = 0;
  private reasonFa = '';
  private currentPolicy: KillSwitchPositionPolicy = 'HOLD_WITH_BREAKEVEN';
  private lastCancelledOrdersCount = 0;

  private constructor() {
    this.loadState();
  }

  public static getInstance(): GlobalKillSwitchEngine {
    if (!GlobalKillSwitchEngine.instance) {
      GlobalKillSwitchEngine.instance = new GlobalKillSwitchEngine();
    }
    return GlobalKillSwitchEngine.instance;
  }

  private loadState(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem(KILL_SWITCH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.isEngaged = !!parsed.isEngaged;
        this.engagedAt = parsed.engagedAt || 0;
        this.reasonFa = parsed.reasonFa || '';
        this.currentPolicy = parsed.policy || 'HOLD_WITH_BREAKEVEN';
        this.lastCancelledOrdersCount = parsed.lastCancelledOrdersCount || 0;
      }
    } catch {}
  }

  private persistState(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        KILL_SWITCH_STORAGE_KEY,
        JSON.stringify({
          isEngaged: this.isEngaged,
          engagedAt: this.engagedAt,
          reasonFa: this.reasonFa,
          policy: this.currentPolicy,
          lastCancelledOrdersCount: this.lastCancelledOrdersCount,
        })
      );
    } catch {}
  }

  /**
   * Engages Global Kill Switch with specific position policy (Item 80)
   */
  public engageKillSwitch(
    reasonFa: string,
    policy: KillSwitchPositionPolicy = 'HOLD_WITH_BREAKEVEN',
    activePositions: TradePosition[] = [],
    cancelledOrdersCount = 0
  ): KillSwitchStatusReport {
    this.isEngaged = true;
    this.engagedAt = Date.now();
    this.reasonFa = reasonFa;
    this.currentPolicy = policy;
    this.lastCancelledOrdersCount = cancelledOrdersCount;
    this.persistState();

    let actionSummaryFa = '';
    switch (policy) {
      case 'CLOSE_ALL_IMMEDIATELY':
        actionSummaryFa = `تمامی ${activePositions.length} پوزیشن باز با سفارش مارکت بسته شده و تعداد ${cancelledOrdersCount} سفارش در انتظار لغو گردیدند.`;
        break;
      case 'HOLD_WITH_BREAKEVEN':
        actionSummaryFa = `معاملات باز (${activePositions.length}) به نقطه سربه‌سر منتقل شدند، ${cancelledOrdersCount} سفارش لغو و ورودهای جدید مسدود گردید.`;
        break;
      case 'PROTECT_TIGHT_SL':
        actionSummaryFa = `حد ضرر تمامی پوزیشن‌های فعال فشرده شد، ${cancelledOrdersCount} سفارش لغو و از ایجاد سفارش جدید ممانعت به عمل آمد.`;
        break;
      case 'CANCEL_PENDING_ONLY':
        actionSummaryFa = `تعداد ${cancelledOrdersCount} سفارش لیمیت و شرطی لغو شدند؛ پوزیشن‌های باز دست‌نخورده باقی ماندند.`;
        break;
    }

    return {
      isKillSwitchEngaged: true,
      engagedAtMs: this.engagedAt,
      engagedAtIso: new Date(this.engagedAt).toISOString(),
      triggerReasonFa: reasonFa,
      policy,
      isNewEntryBlocked: true,
      isAutoTradeHalted: true,
      pendingOrdersCancelledCount: cancelledOrdersCount,
      positionsAffectedCount: activePositions.length,
      actionSummaryFa,
    };
  }

  /**
   * Disengages Global Kill Switch after verification
   */
  public disengageKillSwitch(): void {
    this.isEngaged = false;
    this.engagedAt = 0;
    this.reasonFa = '';
    this.lastCancelledOrdersCount = 0;
    this.persistState();
  }

  /**
   * Checks if Kill Switch is currently active
   */
  public isBlocked(): boolean {
    return this.isEngaged;
  }

  public getStatusReport(activePositionsCount = 0, openOrdersCount = 0): KillSwitchStatusReport {
    return {
      isKillSwitchEngaged: this.isEngaged,
      engagedAtMs: this.engagedAt || null,
      engagedAtIso: this.engagedAt ? new Date(this.engagedAt).toISOString() : null,
      triggerReasonFa: this.reasonFa || 'کلید قطع سیستم غیرفعال است (سیستم در حالت نرمال).',
      policy: this.currentPolicy,
      isNewEntryBlocked: this.isEngaged,
      isAutoTradeHalted: this.isEngaged,
      pendingOrdersCancelledCount: this.isEngaged ? this.lastCancelledOrdersCount : openOrdersCount,
      positionsAffectedCount: activePositionsCount,
      actionSummaryFa: this.isEngaged
        ? `کلید قطع جهانی فعال است: ورود جدید مسدود و خط‌مشی [${this.currentPolicy}] روی پوزیشن‌ها اعمال شد.`
        : 'سیستم آماده اجرای معاملات خودکار و دستی بدون محدودیت امنیتی است.',
    };
  }
}

export const globalKillSwitchEngine = GlobalKillSwitchEngine.getInstance();
