import { Candle } from '../types/trading';

export function ema(values: number[], period: number): number[] {
  const k = 2.0 / (period + 1.0);
  const out: number[] = [];
  let prev: number | null = null;
  for (const v of values) {
    prev = prev === null ? v : v * k + prev * (1.0 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) {
    return new Array(closes.length).fill(50.0);
  }
  const gains: number[] = [];
  const losses: number[] = [];
  const out: number[] = [50.0];

  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0.0;
    const l = ch < 0 ? -ch : 0.0;

    if (i <= period) {
      gains.push(g);
      losses.push(l);
      if (i < period) {
        out.push(50.0);
      } else {
        const ag = gains.reduce((a, b) => a + b, 0) / period;
        const al = losses.reduce((a, b) => a + b, 0) / period;
        out.push(al === 0 ? 100.0 : 100.0 - 100.0 / (1.0 + ag / al));
      }
    } else {
      const ag = (gains[gains.length - 1] * (period - 1) + g) / period;
      const al = (losses[losses.length - 1] * (period - 1) + l) / period;
      gains.push(ag);
      losses.push(al);
      out.push(al === 0 ? 100.0 : 100.0 - 100.0 / (1.0 + ag / al));
    }
  }
  return out;
}

export function stochRsi(closes: number[], period = 14): number {
  const rList = rsi(closes, period);
  if (rList.length < period) return 50.0;
  const win = rList.slice(-period);
  const minR = Math.min(...win);
  const maxR = Math.max(...win);
  if (maxR - minR === 0) return 50.0;
  return ((rList[rList.length - 1] - minR) / (maxR - minR)) * 100.0;
}

export function atr(candles: Candle[], period = 14): number[] {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const h = candles[i][1];
    const l = candles[i][2];
    const tr = i === 0
      ? h - l
      : Math.max(h - l, Math.abs(h - candles[i - 1][3]), Math.abs(l - candles[i - 1][3]));
    trs.push(tr);
  }
  const out: number[] = [];
  for (let i = 0; i < trs.length; i++) {
    const win = trs.slice(Math.max(0, i - period + 1), i + 1);
    const avg = win.reduce((a, b) => a + b, 0) / win.length;
    out.push(avg);
  }
  return out;
}

export function calcCci(candles: Candle[], period = 20): number {
  const tps = candles.map(c => (c[1] + c[2] + c[3]) / 3.0);
  if (tps.length < period) return 0.0;
  const win = tps.slice(-period);
  const smaTp = win.reduce((a, b) => a + b, 0) / period;
  const meanDev = win.reduce((a, x) => a + Math.abs(x - smaTp), 0) / period;
  if (meanDev === 0) return 0.0;
  return (tps[tps.length - 1] - smaTp) / (0.015 * meanDev);
}

export function bollingerBands(closes: number[], period = 20, numStd = 2.0): { upper: number[]; mid: number[]; lower: number[] } {
  const upper: number[] = [];
  const mid: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      mid.push(closes[i]);
      upper.push(closes[i]);
      lower.push(closes[i]);
    } else {
      const win = closes.slice(i - period + 1, i + 1);
      const m = win.reduce((a, b) => a + b, 0) / period;
      const variance = win.reduce((a, x) => a + Math.pow(x - m, 2), 0) / period;
      const std = Math.sqrt(variance);
      mid.push(m);
      upper.push(m + numStd * std);
      lower.push(m - numStd * std);
    }
  }
  return { upper, mid, lower };
}

export function calcMacd(closes: number[]): { macdLine: number[]; sigLine: number[]; hist: number[] } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((e12, i) => e12 - ema26[i]);
  const sigLine = ema(macdLine, 9);
  const hist = macdLine.map((m, i) => m - sigLine[i]);
  return { macdLine, sigLine, hist };
}

export function calcSupertrend(candles: Candle[], period = 10, multiplier = 3.0): { trend: 'BULLISH' | 'BEARISH'; stValues: number[] } {
  const aVals = atr(candles, period);
  let trend = 1;
  let lowerBand = 0.0;
  let upperBand = 0.0;
  const stValues: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const h = c[1];
    const l = c[2];
    const cl = c[3];
    const hl2 = (h + l) / 2.0;
    const up = hl2 + multiplier * aVals[i];
    const dn = hl2 - multiplier * aVals[i];

    if (i === 0) {
      upperBand = up;
      lowerBand = dn;
      stValues.push(lowerBand);
      continue;
    }

    if (dn > lowerBand || candles[i - 1][3] < lowerBand) lowerBand = dn;
    if (up < upperBand || candles[i - 1][3] > upperBand) upperBand = up;

    if (trend === 1) {
      if (cl < lowerBand) {
        trend = -1;
        stValues.push(upperBand);
      } else {
        stValues.push(lowerBand);
      }
    } else {
      if (cl > upperBand) {
        trend = 1;
        stValues.push(lowerBand);
      } else {
        stValues.push(upperBand);
      }
    }
  }
  return { trend: trend === 1 ? 'BULLISH' : 'BEARISH', stValues };
}

export function calcWilliamsR(candles: Candle[], period = 14): number {
  if (candles.length < period) return -50.0;
  const win = candles.slice(-period);
  const hh = Math.max(...win.map(c => c[1]));
  const ll = Math.min(...win.map(c => c[2]));
  const cc = win[win.length - 1][3];
  if (hh - ll === 0) return -50.0;
  return ((hh - cc) / (hh - ll)) * -100.0;
}

export function calcMomentum(closes: number[], period = 10): number {
  if (closes.length <= period) return 0.0;
  return closes[closes.length - 1] - closes[closes.length - 1 - period];
}

export function calcAdx(candles: Candle[], period = 14): { adx: number; pdi: number; mdi: number } {
  const n = candles.length;
  if (n < period * 2) {
    return { adx: 0.0, pdi: 0.0, mdi: 0.0 };
  }
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < n; i++) {
    const h = candles[i][1];
    const l = candles[i][2];
    const ph = candles[i - 1][1];
    const pl = candles[i - 1][2];
    const upMove = h - ph;
    const downMove = pl - l;
    const pdm = upMove > downMove && upMove > 0 ? upMove : 0.0;
    const mdm = downMove > upMove && downMove > 0 ? downMove : 0.0;
    const tr = Math.max(h - l, Math.abs(h - candles[i - 1][3]), Math.abs(l - candles[i - 1][3]));
    plusDm.push(pdm);
    minusDm.push(mdm);
    trs.push(tr);
  }

  function wilder(vals: number[]): number[] {
    const out: number[] = [vals.slice(0, period).reduce((a, b) => a + b, 0) / period];
    for (let i = period; i < vals.length; i++) {
      out.push((out[out.length - 1] * (period - 1) + vals[i]) / period);
    }
    return out;
  }

  const atrS = wilder(trs);
  const plusDmS = wilder(plusDm);
  const minusDmS = wilder(minusDm);

  const pdi = plusDmS.map((p, idx) => (atrS[idx] ? (100.0 * p) / atrS[idx] : 0.0));
  const mdi = minusDmS.map((m, idx) => (atrS[idx] ? (100.0 * m) / atrS[idx] : 0.0));

  const dx = pdi.map((p, idx) => {
    const m = mdi[idx];
    return p + m ? (100.0 * Math.abs(p - m)) / (p + m) : 0.0;
  });

  let adxVal = 0.0;
  if (dx.length >= period) {
    const adxLine = wilder(dx);
    adxVal = adxLine[adxLine.length - 1];
  } else {
    adxVal = dx.length ? dx.reduce((a, b) => a + b, 0) / dx.length : 0.0;
  }

  return {
    adx: adxVal,
    pdi: pdi[pdi.length - 1] || 0.0,
    mdi: mdi[mdi.length - 1] || 0.0,
  };
}

export function calcObv(candles: Candle[]): number[] {
  const obv: number[] = [0.0];
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i][4] || 0.0;
    if (candles[i][3] > candles[i - 1][3]) {
      obv.push(obv[obv.length - 1] + vol);
    } else if (candles[i][3] < candles[i - 1][3]) {
      obv.push(obv[obv.length - 1] - vol);
    } else {
      obv.push(obv[obv.length - 1]);
    }
  }
  return obv;
}

export function calcMfi(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50.0;
  const tps = candles.map(c => (c[1] + c[2] + c[3]) / 3.0);
  let posFlow = 0.0;
  let negFlow = 0.0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const vol = candles[i][4] || 0.0;
    const flow = tps[i] * vol;
    if (tps[i] > tps[i - 1]) posFlow += flow;
    else if (tps[i] < tps[i - 1]) negFlow += flow;
  }

  if (negFlow === 0) return 100.0;
  return 100.0 - 100.0 / (1.0 + posFlow / negFlow);
}

export function calcVwap(candles: Candle[], period = 50): number {
  const win = candles.slice(-Math.min(period, candles.length));
  const tpV = win.map(c => ((c[1] + c[2] + c[3]) / 3.0) * (c[4] || 1.0));
  const vols = win.map(c => c[4] || 1.0);
  const totalV = vols.reduce((a, b) => a + b, 0);
  if (totalV === 0) {
    const last = candles[candles.length - 1];
    return (last[1] + last[2] + last[3]) / 3.0;
  }
  return tpV.reduce((a, b) => a + b, 0) / totalV;
}
