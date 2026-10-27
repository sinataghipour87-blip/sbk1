import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fetchDeribitBlockTrades } from '../src/services/deribitBlockTrades';
import { fetchEthereumLargeTransfers } from '../src/services/ethLargeTransfers';
import { loadVerifiedEthereumExchangeLabels } from '../src/services/exchangeLabels';
import { fetchHyperliquidWhalePositions } from '../src/services/hyperliquidWhales';
import {
  checkCouncilMemberSources,
  inspectCouncilNewsFeed,
} from '../src/services/councilSourceHealth';
import {
  COUNCIL_MEMBER_SOURCES,
  getCouncilMemberSources,
  type CouncilSourceDefinition,
} from '../src/services/councilSourceRegistry';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';

dotenv.config();

const configuredPriceSources = getCouncilMemberSources(1);

const sourceChecks = await checkCouncilMemberSources();
const liveCouncilReport = evaluateEightMemberCouncil({
  pair: 'ETH/USDT:USDT',
  memberSourceChecks: sourceChecks,
  requireMemberSourceQuorum: true,
});
const rows: Array<{
  memberId: number | string;
  sourceId: string;
  priority: number | string;
  status: string;
  httpHealthy: boolean | null;
  dataValid: boolean | null;
  voteValue: 'USEFUL' | 'LOW_VALUE' | 'UNKNOWN';
  detail: string;
  dataDetail: string;
  directional: boolean;
  ethPriceUsd?: number | null;
  normalizedData?: Readonly<Record<string, number | string | null>>;
}> = [];
function hasDirectionalMetric(
  memberId: number | string,
  normalizedData: Readonly<Record<string, number | string | null>> | undefined,
): boolean {
  if (!normalizedData) return false;
  const isNumber = (key: string) =>
    typeof normalizedData[key] === 'number' && Number.isFinite(normalizedData[key]);
  switch (memberId) {
    case 1: return isNumber('returnPct');
    case 2:
      return isNumber('cvdEth') && isNumber('classifiedTradeCount') &&
        Number(normalizedData.classifiedTradeCount) > 0;
    case 3: return isNumber('orderBookImbalance');
    case 4: return isNumber('fundingRate');
    case 5:
      return isNumber('putCallOpenInterestRatio') ||
        isNumber('putCallIvSpread') &&
        Math.abs(Number(normalizedData.putCallIvSpread)) >= 0.02;
    case 6:
      return isNumber('stablecoinSupplyChange7dPct') ||
        isNumber('stakingDeposits24hEth');
    case 7: return isNumber('macroDirectionValue');
    case 8: return isNumber('ethRelevantItemCount24h') &&
      Number(normalizedData.ethRelevantItemCount24h) > 0;
    default: return false;
  }
}
for (const source of [...COUNCIL_MEMBER_SOURCES].filter(({ memberSource }) => memberSource).sort((left, right) =>
  (left.memberIds?.[0] ?? 0) - (right.memberIds?.[0] ?? 0) ||
  (left.priority ?? 0) - (right.priority ?? 0)
)) {
  const memberId = source.memberIds?.[0] ?? 0;
  const check = sourceChecks[memberId]?.find(({ sourceId }) => sourceId === source.id);
  rows.push({
    memberId,
    sourceId: source.id,
    priority: source.priority ?? 0,
    status: check?.status ?? 'BROKEN',
    httpHealthy: check?.httpHealthy ?? null,
    dataValid: check?.dataValid ?? null,
    voteValue: check?.voteValue ?? 'UNKNOWN',
    detail: check?.detail ?? 'No health check result was returned.',
    dataDetail: check?.dataDetail ?? 'Data-level validation did not run.',
    ethPriceUsd: check?.ethPriceUsd ?? null,
    normalizedData: check?.normalizedData,
    directional: hasDirectionalMetric(memberId, check?.normalizedData),
  });
}

const [hyperliquid, deribit, largeTransfers, labels] = await Promise.all([
  fetchHyperliquidWhalePositions(),
  fetchDeribitBlockTrades(),
  fetchEthereumLargeTransfers({ pair: 'ETH/USDT:USDT' }),
  loadVerifiedEthereumExchangeLabels(),
]);
rows.push(
  {
    memberId: 6,
    sourceId: hyperliquid.sourceId,
    priority: '-',
    status: hyperliquid.status === 'LIVE' ? 'HEALTHY' : hyperliquid.status === 'REGION_RESTRICTED' ? 'REGION_RESTRICTED' : 'BROKEN',
    httpHealthy: hyperliquid.status === 'LIVE' ? true : null,
    dataValid: hyperliquid.status === 'LIVE' && hyperliquid.coverage === 'CONFIGURED_ACCOUNTS_ONLY',
    voteValue: hyperliquid.coverage === 'CONFIGURED_ACCOUNTS_ONLY' ? 'USEFUL' : 'UNKNOWN',
    detail: hyperliquid.coverage === 'CONFIGURED_ACCOUNTS_ONLY'
      ? `${hyperliquid.positions.length} ETH positions from configured accounts.`
      : `پوشش ناقص: ${hyperliquid.error ?? 'No verified accounts configured.'}`,
    dataDetail: hyperliquid.coverage === 'CONFIGURED_ACCOUNTS_ONLY'
      ? `${hyperliquid.positions.length} live account positions.`
      : 'No verified account positions available for data validation.',
    directional: false,
  },
  {
    memberId: 6,
    sourceId: deribit.sourceId,
    priority: '-',
    status: deribit.status === 'LIVE' ? 'HEALTHY' : deribit.status === 'REGION_RESTRICTED' ? 'REGION_RESTRICTED' : 'BROKEN',
    httpHealthy: deribit.status === 'LIVE',
    dataValid: deribit.status === 'LIVE',
    voteValue: 'USEFUL',
    detail: deribit.coverage === 'NO_BLOCK_TRADES'
      ? 'Endpoint live; no recent block trades returned.'
      : `${deribit.blockTradeCount} recent block trades.`,
    dataDetail: deribit.coverage === 'NO_BLOCK_TRADES'
      ? 'Valid empty result: no recent block trades.'
      : `${deribit.blockTradeCount} block trades returned.`,
    directional: false,
  },
  {
    memberId: 6,
    sourceId: largeTransfers.sourceId,
    priority: '-',
    status: largeTransfers.status === 'LIVE' ? 'HEALTHY' : 'BROKEN',
    httpHealthy: largeTransfers.status === 'LIVE' ? true : null,
    dataValid: largeTransfers.status === 'LIVE' && largeTransfers.evidence !== null,
    voteValue: largeTransfers.status === 'LIVE' && largeTransfers.evidence !== null ? 'USEFUL' : 'UNKNOWN',
    detail: largeTransfers.reason ?? `Coverage: ${largeTransfers.coverage}.`,
    dataDetail: largeTransfers.reason ?? `coverage=${largeTransfers.coverage}.`,
    directional: false,
  },
  {
    memberId: 6,
    sourceId: 'onchain.ethereum-exchange-labels',
    priority: '-',
    status: labels.length > 0 ? 'HEALTHY' : 'BROKEN',
    httpHealthy: null,
    dataValid: labels.length > 0,
    voteValue: labels.length > 0 ? 'USEFUL' : 'UNKNOWN',
    detail: labels.length > 0
      ? `${labels.length} exchange labels cited to public sources.`
      : 'پوشش ناقص: no public-source-verified exchange labels are configured.',
    dataDetail: labels.length > 0 ? `${labels.length} verified labels.` : 'No verified labels available.',
    directional: false,
  },
);

console.log('عضو | منبع | اولویت | HTTP سالم؟ | داده معتبر؟ | جهت‌ساز؟ | ارزش رأی | جزئیات داده');
console.log('-----|------|--------|------------|-------------|----------|----------|-------------');
for (const row of rows) {
  const http = row.httpHealthy === null ? 'آزمون نشد' : row.httpHealthy ? 'بله' : 'خیر';
  const data = row.dataValid === null ? 'نامشخص' : row.dataValid ? 'بله' : 'خیر';
  const directional = row.directional ? 'بله' : 'خیر';
  const value = row.voteValue === 'LOW_VALUE' ? 'کم‌ارزش برای رأی' : row.voteValue === 'USEFUL' ? 'مفید' : 'نامشخص';
  console.log(`${row.memberId} | ${row.sourceId} | ${row.priority} | ${http} | ${data} | ${directional} | ${value} | ${row.dataDetail}`);
}

console.log('\nرأی مستقیم هر عضو با payloadهای همین بررسی زنده:');
console.log('عضو | رأی | منابع سالم | sourceId | fallbackSourceId | توضیح');
console.log('-----|-----|------------|----------|------------------|-------');
for (const vote of liveCouncilReport.members) {
  console.log(
    `${vote.id} | ${vote.vote} | ${vote.healthySourceCount ?? 0}/4 | ${vote.sourceId ?? '—'} | ${vote.fallbackSourceId ?? '—'} | ${vote.rationaleFa}`,
  );
}

const priceRows = rows.filter((row) =>
  typeof row.memberId === 'number' && row.memberId === 1 && row.ethPriceUsd !== null
);
const expectedPrices = configuredPriceSources.map((source) => {
  const row = rows.find((candidate) => candidate.sourceId === source.id);
  return { sourceId: source.id, price: row?.ethPriceUsd ?? null };
});
console.log('\nقیمت ETH از آخرین کندل ساعتی:');
for (const { sourceId, price } of expectedPrices) {
  console.log(`${sourceId} | ${price === null ? 'ناموجود/نامعتبر' : `$${price.toFixed(2)}`}`);
}
const prices = expectedPrices.flatMap(({ price }) => price === null ? [] : [price]);
if (prices.length >= 2) {
  const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const spreadPct = ((Math.max(...prices) - Math.min(...prices)) / mean) * 100;
  console.log(`دامنه اختلاف نسبت به میانگین: ${spreadPct.toFixed(4)}٪${spreadPct > 0.5 ? ' — هشدار: بیش از ۰٫۵٪' : ''}`);
  if (spreadPct > 0.5) process.exitCode = 1;
} else {
  console.log(`محاسبه اختلاف انجام نشد: فقط ${priceRows.length} قیمت معتبر در دسترس است.`);
}

const registeredNewsSources = getCouncilMemberSources(8);
const cointelegraphDiagnostic: CouncilSourceDefinition = {
  id: 'council.member8.cointelegraph-diagnostic',
  group: 'news',
  provider: 'Cointelegraph',
  url: 'https://cointelegraph.com/rss',
  dataType: 'ETH-filtered RSS diagnostic; excluded from the four voting sources',
  symbol: 'ETH',
  cadence: 'event-driven',
  realtimeEligible: true,
  enabled: true,
  maxAgeMs: 24 * 60 * 60_000,
  priority: 5,
  fallbackGroup: 'council.member8.news',
  memberIds: [8],
  assets: ['ETH'],
  apiKeyRequired: false,
};
const newsDiagnostics = await Promise.all([
  ...registeredNewsSources.map(async (source) => {
    const check = sourceChecks[8]?.find(({ sourceId }) => sourceId === source.id);
    const values = check?.normalizedData ?? {};
    let latestFive: Array<{ title: string; publishedAt: string }> = [];
    const serialized = values.rssLatestFiveJson;
    if (typeof serialized === 'string') {
      try {
        const parsed: unknown = JSON.parse(serialized);
        if (Array.isArray(parsed)) {
          latestFive = parsed.flatMap((item) => {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
            const row = item as Record<string, unknown>;
            return typeof row.title === 'string' && typeof row.publishedAt === 'string'
              ? [{ title: row.title, publishedAt: row.publishedAt }]
              : [];
          });
        }
      } catch {
        latestFive = [];
      }
    }
    return {
      sourceId: source.id,
      provider: source.provider,
      status: check?.status ?? 'BROKEN',
      total: values.rssTotalItems ?? null,
      latest: typeof values.rssLatestPublishedAtMs === 'number'
        ? new Date(values.rssLatestPublishedAtMs).toISOString()
        : null,
      counts: [
        values.ethRelevantItemCount6h ?? null,
        values.ethRelevantItemCount24h ?? null,
        values.ethRelevantItemCount72h ?? null,
      ],
      timezoneProblems: values.rssMissingTimezoneCount ?? null,
      invalidDates: values.rssInvalidDateCount ?? null,
      latestFive,
      detail: check?.dataDetail ?? check?.detail ?? 'No response.',
    };
  }),
  (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(cointelegraphDiagnostic.url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/rss+xml, application/xml;q=0.9' },
      });
      if (!response.ok) {
        return {
          sourceId: cointelegraphDiagnostic.id,
          provider: cointelegraphDiagnostic.provider,
          status: response.status === 403 || response.status === 451
            ? 'REGION_RESTRICTED'
            : 'BROKEN',
          total: null,
          latest: null,
          counts: [null, null, null],
          timezoneProblems: null,
          invalidDates: null,
          latestFive: [],
          detail: `HTTP ${response.status}`,
        };
      }
      const diagnostics = inspectCouncilNewsFeed(
        cointelegraphDiagnostic,
        await response.text(),
      );
      return {
        sourceId: cointelegraphDiagnostic.id,
        provider: cointelegraphDiagnostic.provider,
        status: diagnostics.valid ? 'HEALTHY' : 'BROKEN',
        total: diagnostics.totalItems,
        latest: diagnostics.latestPublishedAtMs === null
          ? null
          : new Date(diagnostics.latestPublishedAtMs).toISOString(),
        counts: [
          diagnostics.relatedItems6h,
          diagnostics.relatedItems24h,
          diagnostics.relatedItems72h,
        ],
        timezoneProblems: diagnostics.missingTimezoneCount,
        invalidDates: diagnostics.invalidDateCount,
        latestFive: diagnostics.latestFive.map(({ title, publishedAt }) => ({ title, publishedAt })),
        detail: diagnostics.detail,
      };
    } catch (error) {
      return {
        sourceId: cointelegraphDiagnostic.id,
        provider: cointelegraphDiagnostic.provider,
        status: 'BROKEN',
        total: null,
        latest: null,
        counts: [null, null, null],
        timezoneProblems: null,
        invalidDates: null,
        latestFive: [],
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  })(),
]);
console.log('\nتشخیص خبر ETH؛ عنوان + توضیح + دسته‌ها، با pubDate/timezone صریح:');
console.log('فید | وضعیت | کل مطالب | تازه‌ترین تاریخ | مرتبط ۶h/۲۴h/۷۲h | timezone نامشخص | تاریخ نامعتبر');
for (const diagnostic of newsDiagnostics) {
  console.log(
    `${diagnostic.provider} (${diagnostic.sourceId}) | ${diagnostic.status} | ${diagnostic.total ?? '—'} | ${diagnostic.latest ?? '—'} | ${diagnostic.counts.join('/')} | ${diagnostic.timezoneProblems ?? '—'} | ${diagnostic.invalidDates ?? '—'}`,
  );
  for (const item of diagnostic.latestFive) {
    const parsedDate = Date.parse(item.publishedAt);
    console.log(`  - ${Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : item.publishedAt} | ${item.title}`);
  }
}

const modelCache = process.env.SBK1_MODEL_CACHE_DIR?.trim() ??
  '.cache/sbk1/open-source-models';
const modelSnapshot = `${modelCache}/models--mrm8488--distilroberta-finetuned-financial-news-sentiment-analysis/snapshots/ae0eab9ad336d7d548e0efe394b07c04bcaf6e91`;
const modelFilesAvailable = ['model.safetensors', 'config.json', 'tokenizer.json', 'tokenizer_config.json']
  .every((file) => existsSync(`${modelSnapshot}/${file}`));
const torchProbe = spawnSync(
  'python3',
  ['-c', "import importlib.util; print('yes' if importlib.util.find_spec('torch') else 'no')"],
  { encoding: 'utf8', timeout: 8_000 },
);
const torchAvailable = torchProbe.status === 0 && torchProbe.stdout.trim() === 'yes';
console.log(
  `مدل احساسات محلی: torch=${torchAvailable ? 'در دسترس' : 'نیست'}؛ فایل‌های مدل=${modelFilesAvailable ? 'موجود' : 'نیست'}؛ رأی عضو ۸ از lexicon کم‌اطمینان استفاده می‌کند.`,
);

const memberCounts = new Map<number, number>();
for (const source of COUNCIL_MEMBER_SOURCES.filter(({ memberSource }) => memberSource)) {
  for (const memberId of source.memberIds ?? []) {
    memberCounts.set(memberId, (memberCounts.get(memberId) ?? 0) + 1);
  }
}
for (let memberId = 1; memberId <= 8; memberId += 1) {
  if (memberCounts.get(memberId) !== 4) {
    throw new Error(`Member ${memberId} has ${memberCounts.get(memberId) ?? 0} registered sources; expected exactly 4.`);
  }
}
if (rows.some(({ status }) => status !== 'HEALTHY')) process.exitCode = 1;
