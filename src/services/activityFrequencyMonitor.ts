/**
 * =============================================================================
 * ⚡ BRAIN ACTIVITY FREQUENCY MONITOR & RUNTIME PULSE RECORDER
 * =============================================================================
 * اصل ۴۸:
 * - حذف کامل هرگونه Math.random() از مانیتورینگ فرکانس و فعالیت مغزها.
 * - ثبت دقیق پالس‌ها در پنجره زمانی لغزان ۶۰ ثانیه‌ای (Real 60-Second Sliding Window).
 * =============================================================================
 */

export interface BrainActivityRecord {
  brainId: string;
  nameFa: string;
  processedCount60s: number;
  lastTimestamp: number | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ActivityMonitorReport {
  timestamp: string;
  totalExecutions60s: number;
  brains: BrainActivityRecord[];
}

export interface LatencyBenchmarkMetric {
  dataArrivalMs: number;
  featureCalculationMs: number;
  decisionLatencyMs: number;
  orderSentLatencyMs: number;
  exchangeAckLatencyMs: number;
  totalChainLatencyMs: number;
  isWithinSla: boolean;
}

export interface ReliabilityAuditReport {
  errorRatePct: number | null;
  connectionDisconnectionCount: number;
  duplicateOrderBlockedRatePct: number | null;
  rejectedSignalsLowDataQualityCount: number;
  totalDecisionsAudited: number;
}

export interface DecisionAuditLogItem {
  decisionId: string;
  timestampUtc: number;
  symbol: string;
  status: 'ACCEPTED_FOR_EXECUTION' | 'REJECTED_RISK_GATE' | 'REJECTED_DATA_QUALITY' | 'REJECTED_REGIME_MISMATCH' | 'REJECTED_DUPLICATE';
  reasonFa: string;
  latencyBreakdownMs: {
    features: number;
    decision: number;
    execution: number;
  };
}

export interface Section9MonitoringDashboard {
  latencyBenchmark: LatencyBenchmarkMetric | null;
  reliabilityAudit: ReliabilityAuditReport;
  recentDecisionAuditLogs: DecisionAuditLogItem[];
  systemHealthVerdictFa: string;
}

export class ActivityFrequencyMonitor {
  private static instance: ActivityFrequencyMonitor;
  private brainPulseTimestamps: Map<string, number[]> = new Map();

  // سنجه‌های بخش نهم: سرعت، پایداری و مانیتورینگ
  private latencyHistory: LatencyBenchmarkMetric[] = [];
  private totalErrorsCount = 0;
  private totalCallsCount = 0;
  private disconnectionsCount = 0;
  private duplicateOrderAttemptsCount = 0;
  private rejectedSignalsLowQualityCount = 0;
  private decisionAuditLogs: DecisionAuditLogItem[] = [];

  public static getInstance(): ActivityFrequencyMonitor {
    if (!ActivityFrequencyMonitor.instance) {
      ActivityFrequencyMonitor.instance = new ActivityFrequencyMonitor();
    }
    return ActivityFrequencyMonitor.instance;
  }

  /**
   * ثبت پردازش واقعی برای یک مغز خاص با زمان دقیق
   */
  public recordBrainPulse(brainId: string): void {
    const now = Date.now();
    const pulses = this.brainPulseTimestamps.get(brainId) || [];
    pulses.push(now);
    // پاکسازی پالس‌های قدیمی‌تر از ۶۰ ثانیه
    const freshPulses = pulses.filter(t => now - t <= 60000);
    this.brainPulseTimestamps.set(brainId, freshPulses);
  }

  /**
   * بررسی دوره‌ای واقعی ۶۰ ثانیه‌ای بدون عدد رندوم
   */
  public evaluateAndMonitor(): ActivityMonitorReport {
    const now = Date.now();
    const brains: BrainActivityRecord[] = [];
    let totalCount = 0;

    const names = [
      '۱. روند فرکتالی کلان',
      '۲. نقدینگی نهنگ و OBI',
      '۳. نوسان‌سنج GARCH',
      '۴. الگوی ۳۰m و واگرایی',
      '۵. هجینگ ریسک صفر',
      '۶. رادار آن‌چین صرافی‌ها',
      '۷. دلتای CVD صدم‌ثانیه‌ای',
      '۸. فاندامنتال و اخبار کلان',
      '۹. شبکه احتمالات بیزی',
      '۱۰. هماهنگ‌ساز Auto-Pilot'
    ];

    for (let i = 1; i <= 10; i++) {
      const bId = `brain_${i}`;
      const pulses = this.brainPulseTimestamps.get(bId) || [];
      // فیلتر واقعی پالس‌ها در ۶۰ ثانیه اخیر
      const activePulsesIn60s = pulses.filter(t => now - t <= 60000);
      this.brainPulseTimestamps.set(bId, activePulsesIn60s);

      const count60s = activePulsesIn60s.length;
      totalCount += count60s;
      const lastTime = activePulsesIn60s.at(-1) ?? null;

      brains.push({
        brainId: bId,
        nameFa: names[i - 1],
        processedCount60s: count60s,
        lastTimestamp: lastTime,
        status: count60s > 0 ? 'ACTIVE' : 'INACTIVE',
      });
    }

    return {
      timestamp: new Date().toLocaleTimeString('fa-IR'),
      totalExecutions60s: totalCount,
      brains,
    };
  }

  /**
   * ⚡ بخش نهم: ثبت نمونه اندازه‌گیری تاخیر در زنجیره پردازش تا اجرا
   */
  public recordLatencySample(metric: Omit<LatencyBenchmarkMetric, 'totalChainLatencyMs' | 'isWithinSla'>): LatencyBenchmarkMetric {
    const durations = [
      metric.dataArrivalMs,
      metric.featureCalculationMs,
      metric.decisionLatencyMs,
      metric.orderSentLatencyMs,
      metric.exchangeAckLatencyMs,
    ];
    if (!durations.every((duration) => Number.isFinite(duration) && duration >= 0)) {
      throw new Error('Latency samples must contain finite, non-negative measurements for every execution stage.');
    }
    const dataArrival = metric.dataArrivalMs;
    const features = metric.featureCalculationMs;
    const decision = metric.decisionLatencyMs;
    const orderSent = metric.orderSentLatencyMs;
    const exchangeAck = metric.exchangeAckLatencyMs;
    const total = dataArrival + features + decision + orderSent + exchangeAck;
    const isWithinSla = total <= 250; // SLA زیر ۲۵۰ میلی‌ثانیه برای سیستم‌های HFT/Quant

    const sample: LatencyBenchmarkMetric = {
      dataArrivalMs: dataArrival,
      featureCalculationMs: features,
      decisionLatencyMs: decision,
      orderSentLatencyMs: orderSent,
      exchangeAckLatencyMs: exchangeAck,
      totalChainLatencyMs: total,
      isWithinSla
    };

    this.latencyHistory.push(sample);
    if (this.latencyHistory.length > 100) {
      this.latencyHistory.shift();
    }

    return sample;
  }

  /**
   * ثبت تصمیم معاملاتی با شناسه یکتا و دلایل رد/پذیرش جهت قابلیت ردیابی کامل
   */
  public recordDecisionAudit(item: DecisionAuditLogItem): void {
    this.totalCallsCount++;
    this.decisionAuditLogs.unshift(item);
    if (this.decisionAuditLogs.length > 200) {
      this.decisionAuditLogs.pop();
    }
  }

  public recordErrorOccurrence(): void {
    this.totalErrorsCount++;
    this.totalCallsCount++;
  }

  public recordNetworkDisconnection(): void {
    this.disconnectionsCount++;
  }

  public recordDuplicateOrderAttempt(): void {
    this.duplicateOrderAttemptsCount++;
  }

  public recordLowQualitySignalRejection(): void {
    this.rejectedSignalsLowQualityCount++;
  }

  /**
   * 🛡️ پالایش امنیتی پیام‌های لاگ: حذف قطعی کلیدهای API، Secretها و توکن‌ها بدون افشای اسرار
   */
  public sanitizeLogMessage(rawMessage: string): string {
    if (!rawMessage) return '';
    return rawMessage
      // حذف کلیدهای API معمول صرافی‌ها
      .replace(/(?:api[_-]?key|apiKey)['"]?\s*[:=]\s*['"]?([A-Za-z0-9_-]{16,})['"]?/gi, 'apiKey: "[REDACTED_API_KEY]"')
      // حذف Secretها و کلمات عبور
      .replace(/(?:api[_-]?secret|apiSecret|secret|password)['"]?\s*[:=]\s*['"]?([A-Za-z0-9_-]{16,})['"]?/gi, 'apiSecret: "[REDACTED_SECRET]"')
      // حذف توکن‌های Bearer
      .replace(/Bearer\s+[A-Za-z0-9_.-]{20,}/gi, 'Bearer [REDACTED_TOKEN]')
      // حذف امضاهای HMAC بلند
      .replace(/(?:sign|signature)['"]?\s*[:=]\s*['"]?([a-f0-9]{32,64})['"]?/gi, 'signature: "[REDACTED_SIGNATURE]"');
  }

  /**
   * دریافت داشبورد جامع مانیتورینگ عملکرد و پایداری بخش نهم
   */
  public getSection9MonitoringReport(): Section9MonitoringDashboard {
    const latestLatency = this.latencyHistory.length > 0
      ? this.latencyHistory[this.latencyHistory.length - 1]
      : null;

    const errorRatePct = this.totalCallsCount > 0
      ? Number(((this.totalErrorsCount / this.totalCallsCount) * 100).toFixed(2))
      : null;
    const duplicateBlockedPct = this.totalCallsCount > 0
      ? Number(((this.duplicateOrderAttemptsCount / this.totalCallsCount) * 100).toFixed(2))
      : null;

    const reliabilityAudit: ReliabilityAuditReport = {
      errorRatePct,
      connectionDisconnectionCount: this.disconnectionsCount,
      duplicateOrderBlockedRatePct: duplicateBlockedPct,
      rejectedSignalsLowDataQualityCount: this.rejectedSignalsLowQualityCount,
      totalDecisionsAudited: this.decisionAuditLogs.length
    };

    let systemHealthVerdictFa = 'دادهٔ کافی برای ارزیابی سلامت و تأخیر زنجیره ثبت نشده است.';
    if (latestLatency && latestLatency.totalChainLatencyMs > 250) {
      systemHealthVerdictFa = '⚠️ هشدار تاخیر: زمان پاسخگویی زنجیره بالاتر از حد مجاز ۲۵۰ میلی‌ثانیه است.';
    } else if ((errorRatePct !== null && errorRatePct > 5.0) || this.disconnectionsCount > 2) {
      systemHealthVerdictFa = '⚠️ هشدار پایداری: نرخ خطای فراخوانی یا قطعی اتصال شبکه نیازمند بررسی است.';
    } else if (latestLatency || errorRatePct !== null) {
      systemHealthVerdictFa = 'داده‌های ثبت‌شده در محدودهٔ هشدار تعریف‌شده هستند؛ این گزارش جایگزین ارزیابی سلامت مدل یا کیفیت سیگنال نیست.';
    }

    return {
      latencyBenchmark: latestLatency,
      reliabilityAudit,
      recentDecisionAuditLogs: this.decisionAuditLogs.slice(0, 20),
      systemHealthVerdictFa
    };
  }
}

export const activityFrequencyMonitor = ActivityFrequencyMonitor.getInstance();
