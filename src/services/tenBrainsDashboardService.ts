export interface BrainDescriptor {
  id: number;
  nameFa: string;
  codeName: string;
}

export class TenBrainsDashboardService {
  private static instance: TenBrainsDashboardService;

  public static getInstance(): TenBrainsDashboardService {
    if (!TenBrainsDashboardService.instance) {
      TenBrainsDashboardService.instance = new TenBrainsDashboardService();
    }
    return TenBrainsDashboardService.instance;
  }

  public getTenBrainsRegistry(): BrainDescriptor[] {
    return [
      { id: 1, nameFa: 'مغز روند کلان فرکتالی', codeName: 'Macro-Fractal-Brain' },
      { id: 2, nameFa: 'رادار نقدینگی و نهنگ‌ها', codeName: 'Whale-Liquidity-Brain' },
      { id: 3, nameFa: 'نوسان‌سنج GARCH و ریسک', codeName: 'GARCH-Risk-Brain' },
      { id: 4, nameFa: 'مومنتوم ۳۰ دقیقه‌ای', codeName: 'Momentum-30m-Brain' },
      { id: 5, nameFa: 'کنترل ریسک و هجینگ پویا', codeName: 'Risk-Governor-Brain' },
      { id: 6, nameFa: 'هوش آن‌چین و جریان صرافی‌ها', codeName: 'OnChain-Intelligence-Brain' },
      { id: 7, nameFa: 'دلتای تجمعی سفارشات (CVD)', codeName: 'CVD-Delta-Brain' },
      { id: 8, nameFa: 'دیوار آتش شوک‌های خبری', codeName: 'News-Shock-Brain' },
      { id: 9, nameFa: 'بیزی و یادگیری تقویتی TF.js', codeName: 'Bayesian-RL-Brain' },
      { id: 10, nameFa: 'خلبان خودکار و هماهنگ‌ساز نهایی', codeName: 'AutoPilot-Synchronizer-Brain' },
      { id: 11, nameFa: 'تحلیل تراکنش‌های بزرگ و احساسات نهنگ‌ها', codeName: 'OnChain-Whale-Sentiment-Brain' },
    ];
  }
}

export const tenBrainsDashboardService = TenBrainsDashboardService.getInstance();
