import { useEffect, useState } from 'react';
import type { AdvisoryModuleResult, OpenSourceAdvisoryReport } from '../services/openSourceAdvisoryService';

interface AdvisoryResponse {
  status: 'NOT_RUN' | OpenSourceAdvisoryReport['status'];
  decisionInfluence: 'ADVISORY_ONLY';
  report: OpenSourceAdvisoryReport | null;
}

const moduleLabels: Array<[keyof OpenSourceAdvisoryReport['modules'], string]> = [
  ['candlestickPatterns', 'الگوهای کندلی · TA-Lib'],
  ['marketRegime', 'رژیم بازار · statsmodels'],
  ['marketAnomaly', 'ناهنجاری · Isolation Forest'],
  ['lightgbmForecast', 'پیش‌بینی بازده · LightGBM'],
  ['xgboostForecast', 'پیش‌بینی بازده · XGBoost'],
  ['newsSentiment', 'احساس تیتر خبر · مدل مالی'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAdvisoryResponse(value: unknown): value is AdvisoryResponse {
  if (!isRecord(value) || value.decisionInfluence !== 'ADVISORY_ONLY') return false;
  if (value.report === null) return value.status === 'NOT_RUN';
  if (!isRecord(value.report) || !isRecord(value.report.modules)) return false;
  return value.report.decisionInfluence === 'ADVISORY_ONLY' &&
    value.report.contractVersion === 'sbk1.open-source-advisories.v1';
}

function asModule(value: unknown): AdvisoryModuleResult {
  return isRecord(value) &&
    (value.status === 'AVAILABLE' || value.status === 'UNAVAILABLE') &&
    (value.sourceTimestampMs === null || typeof value.sourceTimestampMs === 'number')
    ? value as AdvisoryModuleResult
    : { status: 'UNAVAILABLE', sourceTimestampMs: null, reason: 'خروجی ماژول با قرارداد سازگار نیست.' };
}

function showNumber(value: unknown, digits = 4): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('fa-IR', { maximumFractionDigits: digits })
    : '—';
}

function moduleSummary(key: keyof OpenSourceAdvisoryReport['modules'], result: AdvisoryModuleResult): string {
  if (result.status === 'UNAVAILABLE') return String(result.reason ?? 'تحلیل در دسترس نیست.');
  if (key === 'candlestickPatterns') {
    const patterns = Array.isArray(result.patterns) ? result.patterns : [];
    if (!patterns.length) return 'در آخرین کندل الگوی شناخته‌شده‌ای ثبت نشد.';
    return patterns.slice(0, 4).map((item) => {
      if (!isRecord(item)) return '';
      return `${String(item.name)} (${String(item.direction)})`;
    }).filter(Boolean).join('، ');
  }
  if (key === 'marketRegime') {
    const regimes = isRecord(result.regimes) ? result.regimes : {};
    return `${String(result.dominantRegime ?? 'رژیم نامشخص')} · احتمال: ${showNumber(regimes.HIGHER_VOLATILITY, 2)} / ${showNumber(regimes.LOWER_VOLATILITY, 2)}`;
  }
  if (key === 'marketAnomaly') {
    return `${String(result.classification ?? 'وضعیت نامشخص')} · امتیاز: ${showNumber(result.anomalyScore)}`;
  }
  if (key === 'lightgbmForecast' || key === 'xgboostForecast') {
    const explanation = isRecord(result.explainability) ? result.explainability : {};
    const topFeatures = Array.isArray(explanation.topFeatures)
      ? explanation.topFeatures.filter(isRecord).slice(0, 3).map((feature) =>
        `${String(feature.feature)}: ${showNumber(feature.contribution, 4)}`
      ).join('، ')
      : '';
    return `بازده چهار کندل: ${showNumber(result.prediction, 6)} (${String(result.interpretedDirection ?? 'نامشخص')}) · خطای نسبی نگه‌داشته‌شده: ${showNumber(result.holdoutRelativeMaePct, 2)}٪ · کالیبراسیون: ${String(result.calibrationStatus ?? 'UNVALIDATED')} · SHAP: ${topFeatures || String(explanation.status ?? 'UNAVAILABLE')}`;
  }
  const headlines = Array.isArray(result.headlines)
    ? result.headlines.filter(isRecord).slice(0, 3).map((headline) =>
      `${String(headline.publisher)} / ${String(headline.sentiment)}: ${String(headline.headline)}`
    ).join(' | ')
    : '';
  return `امتیاز احساس تیترها: ${showNumber(result.aggregateSentiment, 3)} · تعداد تیتر: ${showNumber(result.headlineCount, 0)}${headlines ? ` · ${headlines}` : ''}`;
}

export function OpenSourceAdvisoryPanel() {
  const [response, setResponse] = useState<AdvisoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await fetch('/api/open-source-advisories', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!result.ok) throw new Error(`درخواست گزارش تحلیل کمکی رد شد (HTTP ${result.status}).`);
        const body: unknown = await result.json();
        if (!isAdvisoryResponse(body)) throw new Error('ساختار پاسخ گزارش تحلیل کمکی معتبر نیست.');
        if (disposed) return;
        setResponse(body);
        setError(null);
      } catch (fetchError) {
        if (disposed || (fetchError instanceof Error && fetchError.name === 'AbortError')) return;
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 10_000);
    return () => {
      disposed = true;
      clearInterval(interval);
      controller?.abort();
    };
  }, []);

  const report = response?.report ?? null;
  return (
    <section dir="rtl" className="rounded-xl border border-cyan-800/60 bg-slate-950/80 p-4 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-cyan-200">تحلیل‌گرهای متن‌باز · فقط شواهد کمکی</h3>
          <p className="mt-1 text-xs text-slate-400">
            خروجی‌ها در رأی، مجوز ورود، ریسک یا ارسال سفارش دخالت ندارند.
          </p>
        </div>
        <span className="rounded-full border border-amber-700/60 px-2.5 py-1 text-[10px] font-bold text-amber-200">
          {report?.status ?? 'NOT_RUN'} · ADVISORY_ONLY
        </span>
      </header>
      {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
      {!report ? (
        <p className="mt-4 text-xs text-slate-400">
          هنوز گزارشی تولید نشده است. تحلیل پس از دریافت کندل کامل از مسیر Freqtrade آغاز می‌شود.
        </p>
      ) : (
        <>
          <p className="mt-3 text-[10px] text-slate-500">
            کندل مبنا: {new Date(report.sourceTimestampMs).toLocaleString('fa-IR')} · تولید: {new Date(report.generatedAtMs).toLocaleString('fa-IR')}
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {moduleLabels.map(([key, label]) => {
              const module = asModule(report.modules[key]);
              return (
                <article key={key} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold text-slate-200">{label}</h4>
                    <span className={`text-[10px] font-bold ${module.status === 'AVAILABLE' ? 'text-emerald-300' : 'text-slate-500'}`}>
                      {module.status}
                    </span>
                  </div>
                  <p className="mt-2 break-words text-xs leading-5 text-slate-300">{moduleSummary(key, module)}</p>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
