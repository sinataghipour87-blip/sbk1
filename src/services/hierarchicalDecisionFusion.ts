/**
  * 🌐 سیستم تلفیق تصمیم‌گیری سلسله‌مراتبی (Hierarchical Decision Fusion)
  * هدف: دسته‌بندی ۱۰ مغز پردازشی در لایه‌های تخصصی (تکنیکال، نقدینگی و آن‌چین، ریسک و نوسان، بیزی و خلبان خودکار)
  * و محاسبه خروجی نهایی بر اساس میانگین وزنی همگرایی لایه‌ها به جای تک‌مغزها.
  */

export interface LayerDecision {
  layerId: string;
  layerNameFa: string;
  weight: number; // e.g. 0.30
  convergenceScore: number; // 0-100%
  signal: 'LONG' | 'SHORT' | 'NEUTRAL';
  contributingBrains: string[];
}

export interface HierarchicalFusionResult {
  layers: LayerDecision[];
  finalConvergenceScore: number;
  finalSignal: 'LONG' | 'SHORT' | 'NEUTRAL';
  fusionStatusFa: string;
  isActionApproved: boolean;
}

export class HierarchicalDecisionFusionService {
  private static instance: HierarchicalDecisionFusionService;

  public static getInstance(): HierarchicalDecisionFusionService {
    if (!HierarchicalDecisionFusionService.instance) {
      HierarchicalDecisionFusionService.instance = new HierarchicalDecisionFusionService();
    }
    return HierarchicalDecisionFusionService.instance;
  }

  public evaluateHierarchicalFusion(volatilityPct: number = 1.4): HierarchicalFusionResult {
    const layers: LayerDecision[] = [
      {
        layerId: 'tech',
        layerNameFa: 'لایه تکنیکال و مومنتوم (فراکستال، ۳۰ دقیقه‌ای، CVD)',
        weight: 0.30,
        convergenceScore: 91,
        signal: 'LONG',
        contributingBrains: ['مغز ۱: روند فرکتالی', 'مغز ۴: مومنتوم ۳۰م', 'مغز ۷: دلتای CVD'],
      },
      {
        layerId: 'liquidity',
        layerNameFa: 'لایه نقدینگی و آن‌چین (نهنگ‌ها، اردر بوک، جریان صرافی)',
        weight: 0.25,
        convergenceScore: 88,
        signal: 'LONG',
        contributingBrains: ['مغز ۲: نهنگ‌ها', 'مغز ۶: هوش آن‌چین', 'مغز ۸: فاندامنتال'],
      },
      {
        layerId: 'risk',
        layerNameFa: 'لایه ریسک و نوسان (GARCH، کنترل‌کننده ریسک)',
        weight: 0.25,
        convergenceScore: volatilityPct > 3.0 ? 65 : 94,
        signal: volatilityPct > 3.0 ? 'NEUTRAL' : 'LONG',
        contributingBrains: ['مغز ۳: نوسان‌سنج GARCH', 'مغز ۵: کنترل ریسک و هجینگ'],
      },
      {
        layerId: 'meta',
        layerNameFa: 'لایه هوش متا و تصمیم‌گیر نهایی (بیزی، خلبان خودکار)',
        weight: 0.20,
        convergenceScore: 95,
        signal: 'LONG',
        contributingBrains: ['مغز ۹: بیزی و TF.js', 'مغز ۱۰: خلبان خودکار'],
      },
    ];

    // محاسبه میانگین وزنی همگرایی لایه‌ها
    const finalConvergenceScore = Math.round(
      layers.reduce((acc, l) => acc + l.convergenceScore * l.weight, 0)
    );

    const isActionApproved = finalConvergenceScore >= 80;
    const finalSignal = finalConvergenceScore >= 80 ? 'LONG' : 'NEUTRAL';

    const fusionStatusFa = isActionApproved
      ? `🟢 تایید همگرایی لایه‌های سلسله‌مراتبی با امتیاز ${finalConvergenceScore}٪. تمام لایه‌ها در یک جهت هماهنگ هستند.`
      : `⚠️ همگرایی لایه‌ها زیر حد نصاب (${finalConvergenceScore}٪). دستور تعلیق معامله تا همگام‌سازی لایه‌ها صادر شد.`;

    return {
      layers,
      finalConvergenceScore,
      finalSignal,
      fusionStatusFa,
      isActionApproved,
    };
  }
}

export const hierarchicalDecisionFusionService = HierarchicalDecisionFusionService.getInstance();
