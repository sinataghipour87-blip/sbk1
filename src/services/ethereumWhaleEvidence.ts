import type { CouncilEthereumWhaleSignal } from './eightMemberCouncil';
import { fetchDeribitBlockTrades } from './deribitBlockTrades';
import { fetchEthereumLargeTransfers } from './ethLargeTransfers';
import { loadVerifiedEthereumExchangeLabels } from './exchangeLabels';
import { fetchHyperliquidWhalePositions } from './hyperliquidWhales';
import { getFreqtradePairBaseAsset } from './freqtradePairs';

export async function fetchEthereumWhaleEvidence(options: {
  pair: string;
  priceUsd?: number | null;
  nowMs?: number;
}): Promise<CouncilEthereumWhaleSignal[]> {
  if (getFreqtradePairBaseAsset(options.pair) !== 'ETH') return [];

  const [hyperliquid, deribit, largeTransfers, labels] = await Promise.all([
    fetchHyperliquidWhalePositions({ nowMs: options.nowMs }),
    fetchDeribitBlockTrades({ nowMs: options.nowMs }),
    fetchEthereumLargeTransfers({
      pair: options.pair,
      priceUsd: options.priceUsd,
      nowMs: options.nowMs,
    }),
    loadVerifiedEthereumExchangeLabels(options.nowMs),
  ]);

  const hyperliquidDirection = hyperliquid.longEth > hyperliquid.shortEth
    ? 'LONG'
    : hyperliquid.shortEth > hyperliquid.longEth
      ? 'SHORT'
      : 'NEUTRAL';
  const deribitDirection = deribit.buyEth > deribit.sellEth
    ? 'LONG'
    : deribit.sellEth > deribit.buyEth
      ? 'SHORT'
      : 'NEUTRAL';
  const hasBlockTrades = deribit.status === 'LIVE' && deribit.blockTradeCount > 0;
  const confirmedLargeTransfers = largeTransfers.evidence?.largeTransfers ?? [];

  return [
    {
      sourceId: hyperliquid.sourceId,
      status: hyperliquid.status,
      direction: hyperliquid.status === 'LIVE' ? hyperliquidDirection : 'UNAVAILABLE',
      confidencePct: hyperliquid.status === 'LIVE' && hyperliquid.positions.length > 0 ? 45 : 0,
      weightPct: hyperliquid.status === 'LIVE' && hyperliquid.positions.length > 0 ? 20 : 0,
      coverage: hyperliquid.coverage === 'CONFIGURED_ACCOUNTS_ONLY'
        ? `${hyperliquid.positions.length} configured accounts only; not a full-market leaderboard.`
        : 'پوشش ناقص: no independently verified whale accounts are configured.',
      coverageComplete: false,
      observedAtMs: hyperliquid.timestampMs,
      interpretationFa: hyperliquid.status === 'LIVE' && hyperliquid.positions.length > 0
        ? `جهت پوزیشن حساب‌های پیکربندی‌شده ${hyperliquidDirection} است؛ پوشش ناقص است و وزن به ۲۰٪ محدود شد.`
        : 'پوشش ناقص: حساب بزرگ تأییدشده برای خواندن پوزیشن تنظیم نشده است.',
      evidence: hyperliquid,
    },
    {
      sourceId: deribit.sourceId,
      status: deribit.status,
      direction: hasBlockTrades ? deribitDirection : deribit.status === 'LIVE' ? 'NEUTRAL' : 'UNAVAILABLE',
      confidencePct: hasBlockTrades ? 50 : 0,
      weightPct: hasBlockTrades ? 20 : 0,
      coverage: hasBlockTrades
        ? 'Recent reported ETH block trades only; venue/API window is incomplete.'
        : deribit.coverage === 'NO_BLOCK_TRADES'
          ? 'Endpoint live but no recent block trades were observed.'
          : 'Unavailable.',
      coverageComplete: false,
      observedAtMs: deribit.timestampMs,
      interpretationFa: hasBlockTrades
        ? `معاملات بلوکی اخیر Deribit ${deribitDirection === 'LONG' ? 'به نفع خرید' : deribitDirection === 'SHORT' ? 'به نفع فروش' : 'خنثی'} است؛ پوشش ناقص و وزن ۲۰٪ است.`
        : deribit.status === 'LIVE'
          ? 'در پنجرهٔ معاملات بررسی‌شده معاملهٔ بلوکی تازه‌ای دیده نشد؛ این به‌تنهایی جهت بازار را مشخص نمی‌کند.'
          : 'دادهٔ معاملهٔ بلوکی تازه در دسترس نیست.',
      evidence: deribit,
    },
    {
      sourceId: largeTransfers.sourceId,
      status: largeTransfers.status === 'LIVE' ? 'LIVE' : 'UNAVAILABLE',
      direction: largeTransfers.status === 'LIVE' && confirmedLargeTransfers.length > 0
        ? 'SHORT'
        : largeTransfers.status === 'LIVE'
          ? 'NEUTRAL'
          : 'UNAVAILABLE',
      confidencePct: largeTransfers.status === 'LIVE' && confirmedLargeTransfers.length > 0 ? 30 : 0,
      weightPct: largeTransfers.status === 'LIVE' && confirmedLargeTransfers.length > 0 ? 10 : 0,
      coverage: largeTransfers.coverage === 'VERIFIED_EXCHANGE_DESTINATIONS'
        ? 'Only sampled transfers to verified exchange labels are covered; outgoing transfers are not scanned.'
        : 'پوشش ناقص: verified exchange labels are not configured.',
      coverageComplete: false,
      observedAtMs: largeTransfers.evidence?.timestampMs ?? null,
      interpretationFa: largeTransfers.status === 'LIVE' && confirmedLargeTransfers.length > 0
        ? 'ورود به آدرس صرافی فقط «احتمال فروش» است، نه فروش قطعی؛ پوشش نمونه‌ای و وزن ۱۰٪ است.'
        : 'انتقال بزرگ با برچسب قابل‌تأیید مشاهده نشد؛ نبود آن اثبات نبود جریان کل شبکه نیست.',
      evidence: {
        thresholdEth: largeTransfers.thresholdEth,
        confirmationsRequired: largeTransfers.confirmationsRequired,
        coverage: largeTransfers.coverage,
        reason: largeTransfers.reason,
        nativeTransfers: confirmedLargeTransfers.filter((transfer) =>
          transfer.asset.toUpperCase() === 'ETH' &&
          transfer.transferId?.startsWith('erc20:') !== true
        ),
        erc20Transfers: confirmedLargeTransfers.filter((transfer) =>
          transfer.transferId?.startsWith('erc20:') === true
        ),
      },
    },
    {
      sourceId: 'onchain.ethereum-exchange-labels',
      status: labels.length > 0 ? 'LIVE' : 'UNAVAILABLE',
      direction: 'UNAVAILABLE',
      confidencePct: 0,
      weightPct: 0,
      coverage: labels.length > 0
        ? `${labels.length} labels with public source URL and review date.`
        : 'پوشش ناقص: no official or independently verifiable exchange wallet labels were found.',
      coverageComplete: false,
      observedAtMs: null,
      interpretationFa: labels.length > 0
        ? 'برچسب‌ها فقط برای تفسیر احتمالی جریان استفاده می‌شوند و قصد معامله را ثابت نمی‌کنند.'
        : 'بدون منبع عمومی قابل‌تأیید هیچ آدرسی به فهرست افزوده نشد.',
      evidence: labels,
    },
  ];
}
