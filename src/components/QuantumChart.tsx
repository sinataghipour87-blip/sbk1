import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AnalysisResult, TradePosition } from '../types/trading';
import { ZoomIn, ZoomOut, RotateCcw, Layers, Zap, Activity, Maximize2, Camera, BarChart2, Radio, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';

interface QuantumChartProps {
  analysis: AnalysisResult;
  prediction?: any;
  activePositions?: TradePosition[];
}

interface PriceBadgeItem {
  id: string;
  label: string;
  subLabel?: string;
  price: number;
  rawY: number;
  adjustedY: number;
  bgGradStart: string;
  bgGradEnd: string;
  textStyle: string;
  borderStyle: string;
  dashPattern: number[];
  lineColor: string;
}

export const QuantumChart: React.FC<QuantumChartProps> = ({ analysis, prediction, activePositions = [] }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Chart view state
  const [visibleCandles, setVisibleCandles] = useState<number>(85);
  const [priceScaleFactor, setPriceScaleFactor] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<number>(0);
  const [timeframe, setTimeframe] = useState<string>('15M');
  const [showIndicators, setShowIndicators] = useState<boolean>(true);
  const [showSmc, setShowSmc] = useState<boolean>(true);
  const [showVrvp, setShowVrvp] = useState<boolean>(true);

  // Interactive mouse state (Ref-based for 60FPS zero-lag rendering without React re-render overhead)
  const crosshairRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartPanRef = useRef<number>(0);

  // Cached smooth bounds to prevent vertical chart jumping
  const smoothBoundsRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });

  const zoomIn = () => setVisibleCandles(prev => Math.max(25, prev - 12));
  const zoomOut = () => setVisibleCandles(prev => Math.min(prev + 15, analysis?.candles?.length || 120));
  const zoomReset = () => {
    setVisibleCandles(85);
    setPriceScaleFactor(1.0);
    setPanOffset(0);
  };

  // Export PNG Snapshot
  const exportChartSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `SB_2126_Quantum_Chart_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = dataUrl;
    link.click();
  };

  // Toggle Fullscreen Mode
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Canvas drawing routine - Full-Width 2126 Quantum Engine
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const targetW = Math.floor(rect.width) || container.clientWidth || 800;
    const targetH = Math.floor(rect.height) || container.clientHeight || 420;

    if (targetW <= 0 || targetH <= 0) return;

    if (canvas.width !== targetW * dpr || canvas.height !== targetH * dpr) {
      canvas.width = targetW * dpr;
      canvas.height = targetH * dpr;
      canvas.style.width = `${targetW}px`;
      canvas.style.height = `${targetH}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const width = targetW;
    const height = targetH;

    // 1. Deep Obsidian Space Canvas Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#020612');
    bgGrad.addColorStop(1, '#00030a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    if (!analysis || !analysis.candles || analysis.candles.length === 0) {
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ در حال دریافت داده‌های همگام‌سازی BTC/USDT...', width / 2, height / 2);
      ctx.restore();
      return;
    }

    // Dynamic Height Partitions: Main chart (74%), MACD Sub-chart (26%)
    const mainHeight = height * 0.74;
    const macdTop = mainHeight + 10;
    const macdHeight = Math.max(22, height - macdTop - 8);

    const totalCandlesCount = analysis.candles.length;
    const count = Math.min(visibleCandles, totalCandlesCount);
    
    // Handle pan offset bounds
    const maxPan = Math.max(0, totalCandlesCount - count);
    const clampedPan = Math.max(0, Math.min(panOffset, maxPan));

    const startIdx = Math.max(0, totalCandlesCount - count - clampedPan);
    const endIdx = startIdx + count;

    const candles = analysis.candles.slice(startIdx, endIdx);
    const ema20 = (analysis.ema20 || []).slice(startIdx, endIdx);
    const ema50 = (analysis.ema50 || []).slice(startIdx, endIdx);
    const ema200 = (analysis.ema200 || []).slice(startIdx, endIdx);
    const bbUp = (analysis.bbUp || []).slice(startIdx, endIdx);
    const bbLow = (analysis.bbLow || []).slice(startIdx, endIdx);
    const macdH = (analysis.macdH || []).slice(startIdx, endIdx);

    if (candles.length === 0) {
      ctx.restore();
      return;
    }

    // Determine Price Bounds with boundary damping
    let rawMin = Math.min(...candles.map(c => c[2]));
    let rawMax = Math.max(...candles.map(c => c[1]));

    const forecastList = prediction?.forecast15m || [];
    if (clampedPan === 0) {
      forecastList.forEach((fc: any) => {
        if (fc.high) rawMax = Math.max(rawMax, fc.high);
        if (fc.low) rawMin = Math.min(rawMin, fc.low);
        if (fc.price) {
          rawMax = Math.max(rawMax, fc.price);
          rawMin = Math.min(rawMin, fc.price);
        }
      });
    }

    if (analysis.tp3) rawMax = Math.max(rawMax, analysis.tp3);
    if (analysis.sl) rawMin = Math.min(rawMin, analysis.sl);

    // Pad bounds
    const rawPadding = Math.max(10, (rawMax - rawMin) * 0.08);
    rawMin -= rawPadding;
    rawMax += rawPadding;

    // Smooth dampening
    if (smoothBoundsRef.current.min === 0 || Math.abs(smoothBoundsRef.current.min - rawMin) > 800) {
      smoothBoundsRef.current = { min: rawMin, max: rawMax };
    } else {
      smoothBoundsRef.current.min = smoothBoundsRef.current.min * 0.85 + rawMin * 0.15;
      smoothBoundsRef.current.max = smoothBoundsRef.current.max * 0.85 + rawMax * 0.15;
    }

    const midP = (smoothBoundsRef.current.min + smoothBoundsRef.current.max) / 2.0;
    const halfRange = ((smoothBoundsRef.current.max - smoothBoundsRef.current.min) / 2.0) * priceScaleFactor;
    const adjustedMin = midP - halfRange;
    const adjustedMax = midP + halfRange;
    const priceSpan = adjustedMax - adjustedMin || 1;

    const getY = (val: number) => {
      return mainHeight - ((val - adjustedMin) / priceSpan) * (mainHeight - 25) - 20;
    };

    // Full-Width Geometry: 0px left margin so the chart is 100% wide up to right price axis (75px)
    const leftMargin = 0;
    const rightMargin = 75;

    const forecastCount = clampedPan === 0 ? 5 : 0;
    const totalSteps = count + forecastCount;
    const chartXStart = leftMargin;
    const chartWidth = width - leftMargin - rightMargin;
    const stepX = chartWidth / totalSteps;

    // 2. VRVP Volume Profile Histogram (Right Edge)
    if (showVrvp) {
      const vrvpBins = 20;
      const binStep = priceSpan / vrvpBins;
      const binVolumes = new Array(vrvpBins).fill(0);

      candles.forEach(c => {
        const closeP = c[3];
        const vol = c[4] || (Math.abs(c[3] - c[0]) * 10);
        const binIdx = Math.max(0, Math.min(vrvpBins - 1, Math.floor((closeP - adjustedMin) / binStep)));
        binVolumes[binIdx] += vol;
      });

      const maxBinVol = Math.max(...binVolumes) || 1;
      let pocBinIdx = 0;
      let maxVol = 0;

      binVolumes.forEach((v, idx) => {
        if (v > maxVol) {
          maxVol = v;
          pocBinIdx = idx;
        }
      });

      // Draw VRVP Horizontal Shaded Bars
      const maxVrvpWidth = 55;
      const vrvpRightX = chartWidth;
      for (let b = 0; b < vrvpBins; b++) {
        const bPrice = adjustedMin + b * binStep + binStep / 2;
        const bY = getY(bPrice);
        const barW = (binVolumes[b] / maxBinVol) * maxVrvpWidth;
        const isPoc = b === pocBinIdx;

        ctx.fillStyle = isPoc ? 'rgba(234, 179, 8, 0.3)' : 'rgba(0, 240, 255, 0.12)';
        ctx.fillRect(vrvpRightX - barW, bY - 3, barW, 6);

        if (isPoc) {
          ctx.strokeStyle = 'rgba(234, 179, 8, 0.8)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(chartXStart, bY);
          ctx.lineTo(vrvpRightX, bY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#eab308';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'right';
          ctx.fillText('POC', vrvpRightX - barW - 4, bY + 3);
        }
      }
    }

    // 3. Horizontal Grid Lines & Price Scale Labels (Right Axis)
    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
      const p = adjustedMin + (priceSpan / gridSteps) * i;
      const y = getY(p);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(chartXStart, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();

      // Right Axis Price Text
      ctx.setLineDash([]);
      ctx.fillStyle = '#64748b';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, chartWidth + 5, y + 3);
      ctx.setLineDash([4, 4]);
    }
    ctx.setLineDash([]);

    // 4. SMC Order Block Zone
    if (showSmc && analysis.smcOrderBlock) {
      const ob = analysis.smcOrderBlock;
      const yTop = getY(ob.top);
      const yBottom = getY(ob.bottom);
      const obHeight = Math.max(8, Math.abs(yBottom - yTop));
      const obY = Math.min(yTop, yBottom);

      ctx.fillStyle = ob.type === 'BULLISH' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)';
      ctx.strokeStyle = ob.type === 'BULLISH' ? 'rgba(16, 185, 129, 0.45)' : 'rgba(244, 63, 94, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.fillRect(chartXStart, obY, chartWidth, obHeight);
      ctx.strokeRect(chartXStart, obY, chartWidth, obHeight);
      ctx.setLineDash([]);

      ctx.fillStyle = ob.type === 'BULLISH' ? '#34d399' : '#fb7185';
      ctx.font = 'bold 8.5px monospace';
      ctx.fillText(`[ ${ob.label} ]`, chartXStart + 8, obY + 11);
    }

    // 5. Bollinger Bands
    if (showIndicators && bbUp.length === count && bbLow.length === count) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.3)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      for (let i = 0; i < count; i++) {
        const x = chartXStart + i * stepX + stepX / 2;
        const y = getY(bbUp[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = chartXStart + i * stepX + stepX / 2;
        const y = getY(bbLow[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 6. EMA Lines
    if (showIndicators) {
      // EMA 20 (Cyan)
      if (ema20.length === count) {
        ctx.beginPath();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.3;
        for (let i = 0; i < count; i++) {
          const x = chartXStart + i * stepX + stepX / 2;
          const y = getY(ema20[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // EMA 50 (Amber)
      if (ema50.length === count) {
        ctx.beginPath();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.3;
        for (let i = 0; i < count; i++) {
          const x = chartXStart + i * stepX + stepX / 2;
          const y = getY(ema50[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // EMA 200 (Purple)
      if (ema200.length === count) {
        ctx.beginPath();
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < count; i++) {
          const x = chartXStart + i * stepX + stepX / 2;
          const y = getY(ema200[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // 7. High-Contrast Candlesticks
    const candleWidth = Math.max(3, stepX * 0.72);
    candles.forEach((c, i) => {
      const [open, high, low, close] = c;
      const x = chartXStart + i * stepX + stepX / 2;
      const yOpen = getY(open);
      const yClose = getY(close);
      const yHigh = getY(high);
      const yLow = getY(low);

      const isBullish = close >= open;
      const color = isBullish ? '#10b981' : '#f43f5e';

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // Body
      const bodyY = Math.min(yOpen, yClose);
      const bodyH = Math.max(1.8, Math.abs(yOpen - yClose));
      
      ctx.fillStyle = color;
      ctx.fillRect(x - candleWidth / 2, bodyY, candleWidth, bodyH);
    });

    // 8. 5-Candle Trend Projection Ray
    if (clampedPan === 0 && forecastList.length > 0) {
      const lastCandleIdx = count - 1;
      const lastX = chartXStart + lastCandleIdx * stepX + stepX / 2;
      const lastY = getY(analysis.price);

      const isLongTrend = (prediction?.trend === 'BULLISH') || (analysis.direction === 'LONG');
      const forecastColor = isLongTrend ? '#34d399' : '#fb7185';

      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      forecastList.forEach((fc: any, fIdx: number) => {
        const fx = chartXStart + (count + fIdx) * stepX + stepX / 2;
        const fy = getY(fc.close || fc.price);
        ctx.lineTo(fx, fy);
      });
      ctx.strokeStyle = forecastColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw 5 Forecast Candlesticks
      forecastList.forEach((fc: any, fIdx: number) => {
        const fx = chartXStart + (count + fIdx) * stepX + stepX / 2;
        const cOpen = fc.open || (fIdx === 0 ? analysis.price : (forecastList[fIdx - 1]?.close || analysis.price));
        const cClose = fc.close || fc.price;
        const cHigh = fc.high || Math.max(cOpen, cClose) + (Math.abs(cClose - cOpen) * 0.3);
        const cLow = fc.low || Math.min(cOpen, cClose) - (Math.abs(cClose - cOpen) * 0.3);

        const fyOpen = getY(cOpen);
        const fyClose = getY(cClose);
        const fyHigh = getY(cHigh);
        const fyLow = getY(cLow);

        const isBull = cClose >= cOpen;
        const candleColor = isBull ? '#34d399' : '#fb7185';
        const bodyFill = isBull ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)';

        ctx.strokeStyle = candleColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 1]);
        ctx.beginPath();
        ctx.moveTo(fx, fyHigh);
        ctx.lineTo(fx, fyLow);
        ctx.stroke();
        ctx.setLineDash([]);

        const predBodyY = Math.min(fyOpen, fyClose);
        const predBodyH = Math.max(2, Math.abs(fyOpen - fyClose));
        ctx.fillStyle = bodyFill;
        ctx.fillRect(fx - candleWidth / 2, predBodyY, candleWidth, predBodyH);
        ctx.strokeStyle = candleColor;
        ctx.strokeRect(fx - candleWidth / 2, predBodyY, candleWidth, predBodyH);

        ctx.fillStyle = candleColor;
        ctx.beginPath();
        ctx.arc(fx, fyClose, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Target Badge
      const finalForecast = forecastList[forecastList.length - 1];
      if (finalForecast) {
        const lastFx = chartXStart + (count + forecastList.length - 1) * stepX + stepX / 2;
        const lastFy = getY(finalForecast.close || finalForecast.price);
        const targetPrice = (finalForecast.close || finalForecast.price).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

        ctx.fillStyle = isLongTrend ? '#064e3b' : '#881337';
        ctx.strokeStyle = isLongTrend ? '#34d399' : '#fb7185';
        ctx.lineWidth = 1;
        const badgeW = 95;
        const badgeH = 18;
        const badgeX = Math.min(chartWidth - 5, lastFx + 6);
        const badgeY = Math.max(12, Math.min(mainHeight - 25, lastFy - 9));

        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`📊 SIM: $${targetPrice}`, badgeX + badgeW / 2, badgeY + 12);
      }
    }

    // 9. CLEAN TARGET BADGES & PRICE BEAMS (TP1, TP2, FINAL TP, SL)
    // Zero Collisions & 100% Full-Width Chart Layout
    const levelItems: PriceBadgeItem[] = [];

    if (analysis.tp1) {
      levelItems.push({
        id: 'tp1',
        label: 'TP1',
        subLabel: `$${analysis.tp1.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        price: analysis.tp1,
        rawY: getY(analysis.tp1),
        adjustedY: getY(analysis.tp1),
        bgGradStart: '#064e3b',
        bgGradEnd: '#022c22',
        textStyle: '#34d399',
        borderStyle: '#10b981',
        dashPattern: [4, 4],
        lineColor: '#10b981',
      });
    }

    if (analysis.tp2) {
      levelItems.push({
        id: 'tp2',
        label: 'TP2',
        subLabel: `$${analysis.tp2.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        price: analysis.tp2,
        rawY: getY(analysis.tp2),
        adjustedY: getY(analysis.tp2),
        bgGradStart: '#083344',
        bgGradEnd: '#041f2d',
        textStyle: '#22d3ee',
        borderStyle: '#06b6d4',
        dashPattern: [4, 4],
        lineColor: '#06b6d4',
      });
    }

    if (analysis.tp3) {
      levelItems.push({
        id: 'tp3',
        label: 'FINAL TP',
        subLabel: `$${analysis.tp3.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        price: analysis.tp3,
        rawY: getY(analysis.tp3),
        adjustedY: getY(analysis.tp3),
        bgGradStart: '#3b0764',
        bgGradEnd: '#240342',
        textStyle: '#c084fc',
        borderStyle: '#a855f7',
        dashPattern: [],
        lineColor: '#a855f7',
      });
    }

    if (analysis.sl) {
      levelItems.push({
        id: 'sl',
        label: 'STOP LOSS',
        subLabel: `$${analysis.sl.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        price: analysis.sl,
        rawY: getY(analysis.sl),
        adjustedY: getY(analysis.sl),
        bgGradStart: '#881337',
        bgGradEnd: '#4c0519',
        textStyle: '#fb7185',
        borderStyle: '#f43f5e',
        dashPattern: [4, 3],
        lineColor: '#f43f5e',
      });
    }

    // Sort levels by Y position ascending
    levelItems.sort((a, b) => a.rawY - b.rawY);

    // Initial clamp within canvas top and bottom boundaries
    levelItems.forEach(item => {
      item.adjustedY = Math.max(14, Math.min(mainHeight - 14, item.adjustedY));
    });

    // Resolve Y collisions with minimum 20px clearance
    const minBadgeGap = 20;
    for (let i = 1; i < levelItems.length; i++) {
      const prev = levelItems[i - 1];
      const curr = levelItems[i];
      if (curr.adjustedY - prev.adjustedY < minBadgeGap) {
        curr.adjustedY = prev.adjustedY + minBadgeGap;
      }
    }

    // Re-clamp bottom boundary after spacing adjustments
    for (let i = levelItems.length - 1; i >= 0; i--) {
      if (levelItems[i].adjustedY > mainHeight - 14) {
        levelItems[i].adjustedY = mainHeight - 14;
        if (i > 0 && levelItems[i].adjustedY - levelItems[i - 1].adjustedY < minBadgeGap) {
          levelItems[i - 1].adjustedY = levelItems[i].adjustedY - minBadgeGap;
        }
      }
    }

    // Draw Target Price Lines & Left-Anchored Compact Pills safely inside canvas
    levelItems.forEach(item => {
      const clampedLineY = Math.max(2, Math.min(mainHeight - 2, item.rawY));

      // Horizontal Price Line
      ctx.strokeStyle = item.lineColor;
      ctx.lineWidth = 1;
      if (item.dashPattern && item.dashPattern.length) {
        ctx.setLineDash(item.dashPattern);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.moveTo(chartXStart, clampedLineY);
      ctx.lineTo(chartWidth, clampedLineY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Connecting Leader Line if Badge is Shifted Vertically
      if (Math.abs(item.adjustedY - clampedLineY) > 2) {
        ctx.strokeStyle = item.borderStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(105, item.adjustedY);
        ctx.lineTo(105, clampedLineY);
        ctx.stroke();
      }

      // Pill Box Badge Anchored Left
      const pillW = 100;
      const pillH = 18;
      const pillX = 6;
      const pillY = Math.max(2, Math.min(mainHeight - pillH - 2, item.adjustedY - 9));

      const pGrad = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY);
      pGrad.addColorStop(0, item.bgGradStart);
      pGrad.addColorStop(1, item.bgGradEnd);

      ctx.fillStyle = pGrad;
      ctx.strokeStyle = item.borderStyle;
      ctx.lineWidth = 1;
      ctx.fillRect(pillX, pillY, pillW, pillH);
      ctx.strokeRect(pillX, pillY, pillW, pillH);

      // Label & Sublabel Text
      ctx.fillStyle = item.textStyle;
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, pillX + 5, pillY + 12);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8.5px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(item.subLabel || '', pillX + pillW - 4, pillY + 12);
    });

    // 9.5. REAL-TIME ACTIVE OPEN POSITIONS OVERLAY (Drawn directly on chart canvas)
    if (activePositions && activePositions.length > 0) {
      activePositions.forEach((pos, pIdx) => {
        const entryY = Math.max(2, Math.min(mainHeight - 2, getY(pos.entry)));
        const curP = analysis.price;
        const curY = Math.max(2, Math.min(mainHeight - 2, getY(curP)));

        // Calculate Real-Time PnL
        let pnlPct = 0;
        if (pos.dir === 'LONG') {
          pnlPct = ((curP - pos.entry) / pos.entry) * 100.0 * pos.lev;
        } else {
          pnlPct = ((pos.entry - curP) / pos.entry) * 100.0 * pos.lev;
        }
        const pnlUsd = (pos.initialMargin || pos.margin) * (pnlPct / 100.0);
        const isProfit = pnlUsd >= 0;

        // 1. Shaded PnL Region between Entry Price & Current Price
        const minY = Math.min(entryY, curY);
        const maxY = Math.max(entryY, curY);
        const pnlZoneH = Math.max(2, maxY - minY);

        ctx.fillStyle = isProfit ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)';
        ctx.fillRect(chartXStart, minY, chartWidth, pnlZoneH);

        // 2. High-Glow Active Entry Price Line
        ctx.strokeStyle = isProfit ? '#10b981' : '#f43f5e';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(chartXStart, entryY);
        ctx.lineTo(chartWidth, entryY);
        ctx.stroke();
        ctx.setLineDash([]);

        // 3. Floating Live PnL Badge (Anchored near right edge of chart)
        const badgeW = 200;
        const badgeH = 22;
        const badgeX = Math.max(chartXStart + 10, chartWidth - badgeW - 10);
        const badgeY = Math.max(10, Math.min(mainHeight - badgeH - 10, entryY - badgeH / 2 + (pIdx * 25)));

        const bGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY);
        bGrad.addColorStop(0, pos.dir === 'LONG' ? '#064e3b' : '#881337');
        bGrad.addColorStop(1, '#020612');

        ctx.fillStyle = bGrad;
        ctx.strokeStyle = isProfit ? '#34d399' : '#fb7185';
        ctx.lineWidth = 1.2;
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

        const dirIcon = pos.dir === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
        const pnlSign = pnlUsd >= 0 ? '+' : '';
        const pnlStr = `${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(1)}%)`;

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8.5px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`[${pos.name || 'POSITION'}] ${dirIcon} ${pos.lev}x @ $${pos.entry.toFixed(0)}`, badgeX + 6, badgeY + 14);

        ctx.fillStyle = isProfit ? '#34d399' : '#fb7185';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(pnlStr, badgeX + badgeW - 6, badgeY + 14);
      });
    }

    // 10. Current Price Line & Right Axis Tag
    const curY = getY(analysis.price);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(chartXStart, curY);
    ctx.lineTo(chartWidth, curY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price Tag on Right Axis
    const curPriceX = chartWidth + 2;
    ctx.fillStyle = '#059669';
    ctx.fillRect(curPriceX, curY - 9, 70, 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9.5px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`$${analysis.price.toFixed(1)}`, curPriceX + 4, curY + 3);

    // 11. MACD Sub-chart (Clean without text)
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartXStart, mainHeight + 2);
    ctx.lineTo(chartWidth, mainHeight + 2);
    ctx.stroke();

    const macdZeroY = macdTop + macdHeight / 2;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.beginPath();
    ctx.moveTo(chartXStart, macdZeroY);
    ctx.lineTo(chartWidth, macdZeroY);
    ctx.stroke();

    if (macdH.length > 0) {
      const maxMacdH = Math.max(...macdH.map(h => Math.abs(h))) || 1;
      macdH.forEach((h, i) => {
        const x = chartXStart + i * stepX + stepX / 2;
        const barW = Math.max(1.2, stepX * 0.6);
        const barH = (h / maxMacdH) * (macdHeight / 2 - 3);
        ctx.fillStyle = h >= 0 ? '#10b981' : '#f43f5e';
        ctx.fillRect(x - barW / 2, macdZeroY, barW, -barH);
      });
    }

    // 12. Crosshair & Safe Clamped OHLC Tooltip
    const crosshair = crosshairRef.current;
    if (crosshair) {
      const { x, y } = crosshair;
      
      if (x >= 0 && x <= chartWidth && y >= 0 && y <= height) {
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);

        ctx.beginPath();
        ctx.moveTo(chartXStart, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.setLineDash([]);

        const hoverPrice = adjustedMax - (y / mainHeight) * priceSpan;
        if (hoverPrice > 0) {
          ctx.fillStyle = '#065f46';
          ctx.fillRect(curPriceX, y - 8, 70, 16);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9.5px monospace';
          ctx.fillText(`$${hoverPrice.toFixed(1)}`, curPriceX + 4, y + 3);
        }

        const hoverCandleIdx = Math.floor(x / stepX);
        if (hoverCandleIdx >= 0 && hoverCandleIdx < candles.length) {
          const hoveredCandle = candles[hoverCandleIdx];
          const [open, high, low, close] = hoveredCandle;
          const isBull = close >= open;

          const tooltipWidth = 130;
          const tooltipX = Math.max(10, Math.min(chartWidth - tooltipWidth - 10, x - tooltipWidth / 2));

          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.fillRect(tooltipX, 6, tooltipWidth, 20);
          ctx.strokeStyle = isBull ? '#10b981' : '#f43f5e';
          ctx.lineWidth = 1;
          ctx.strokeRect(tooltipX, 6, tooltipWidth, 20);

          ctx.fillStyle = isBull ? '#34d399' : '#fb7185';
          ctx.font = 'bold 8.5px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`O:${open.toFixed(0)} H:${high.toFixed(0)} L:${low.toFixed(0)} C:${close.toFixed(0)}`, tooltipX + tooltipWidth / 2, 19);
        }
      }
    }

    ctx.restore();
  }, [analysis, prediction, activePositions, visibleCandles, priceScaleFactor, panOffset, showIndicators, showSmc, showVrvp]);

  // Interactive Dragging and Mouse Event Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartPanRef.current = panOffset;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    crosshairRef.current = { x, y };

    if (isDraggingRef.current) {
      const deltaX = e.clientX - dragStartXRef.current;
      const stepX = (rect.width - 75) / visibleCandles;
      const candleDelta = Math.round(deltaX / stepX);
      setPanOffset(dragStartPanRef.current + candleDelta);
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    crosshairRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else {
      zoomOut();
    }
  };

  // Continuous 60FPS animation loop
  useEffect(() => {
    let animId: number;
    const loop = () => {
      drawChart();
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    const container = containerRef.current;
    let observer: ResizeObserver | null = null;
    let resizeRafId: number | null = null;
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          drawChart();
        });
      });
      observer.observe(container);
    }

    const handleResize = () => {
      drawChart();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [drawChart]);

  return (
    <div className="flex flex-col flex-1 w-full h-full min-h-[250px] relative font-mono select-none overflow-hidden">
      {/* Integrated Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 border-b border-emerald-950/80 pb-2 relative z-20">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Timeframe Selector Pills */}
          <div className="flex items-center bg-[#020712] rounded-lg p-0.5 border border-emerald-900/60 text-[10px]">
            {['1M', '5M', '15M', '1H', '4H', '1D'].map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-1.5 py-0.5 rounded transition cursor-pointer font-bold ${
                  timeframe === tf
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-emerald-950/80 px-2 py-0.5 rounded-lg border border-emerald-500/40 text-[11px] text-emerald-300 shadow-sm">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>SB 2126 QUANTUM</span>
          </div>

          {activePositions.length > 0 && (
            <div className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 border border-emerald-400 px-2.5 py-0.5 rounded-lg text-[10px] text-emerald-300 font-bold animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.3)]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>پوزیشن زنده روی چارت ({activePositions.length})</span>
            </div>
          )}

          <div className="flex items-center gap-0.5 bg-[#020712] rounded-lg p-0.5 border border-emerald-900/60 shadow-inner">
            <button
              onClick={zoomIn}
              className="p-1 hover:bg-emerald-950 rounded text-emerald-300 transition cursor-pointer"
              title="بزرگ‌نمایی (کندل کمتر)"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              onClick={zoomOut}
              className="p-1 hover:bg-emerald-950 rounded text-emerald-300 transition cursor-pointer"
              title="کوچک‌نمایی (کندل بیشتر)"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <button
              onClick={zoomReset}
              className="p-1 hover:bg-emerald-950 rounded text-emerald-300 transition cursor-pointer"
              title="ریست زوم"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setShowVrvp(!showVrvp)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] transition-all cursor-pointer ${
              showVrvp
                ? 'bg-emerald-950/90 text-amber-300 border border-amber-500/50 shadow-sm'
                : 'bg-slate-900/60 text-slate-400 border border-slate-800'
            }`}
            title="نمایش حجم پروفایل VRVP و نقطه کنترل POC"
          >
            <BarChart2 className="w-3 h-3" />
            <span>VRVP / POC</span>
          </button>

          <button
            onClick={() => setShowIndicators(!showIndicators)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] transition-all cursor-pointer ${
              showIndicators
                ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 shadow-sm'
                : 'bg-slate-900/60 text-slate-400 border border-slate-800'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>اندیکاتورها</span>
          </button>

          <button
            onClick={() => setShowSmc(!showSmc)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] transition-all cursor-pointer ${
              showSmc
                ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 shadow-sm'
                : 'bg-slate-900/60 text-slate-400 border border-slate-800'
            }`}
          >
            <Zap className="w-3 h-3" />
            <span>SMC</span>
          </button>

          {/* Screenshot / Snapshot Export */}
          <button
            onClick={exportChartSnapshot}
            className="p-1 hover:bg-emerald-950 rounded-lg text-emerald-300 border border-emerald-900/60 transition cursor-pointer"
            title="ذخیره عکس با کیفیت از نمودار (PNG Snapshot)"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-1 hover:bg-emerald-950 rounded-lg text-emerald-300 border border-emerald-900/60 transition cursor-pointer"
            title="نمایش تمام‌صفحه چارت"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Dynamic Masterpiece Canvas Container */}
      <div
        ref={containerRef}
        className="relative flex-1 w-full min-h-[200px] h-full max-h-[calc(100vh-320px)] rounded-xl overflow-hidden bg-[#01040a] gpu-accelerated border border-emerald-500/30 shadow-[inset_0_0_20px_rgba(16,185,129,0.06)] cursor-crosshair select-none"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          className="w-full h-full block relative z-10"
        />
      </div>

      {/* Footer Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-1.5 border-t border-emerald-950/80 text-[10px] text-slate-400 relative z-20">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="flex items-center gap-1 text-cyan-300">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span> EMA20
          </span>
          <span className="flex items-center gap-1 text-amber-300">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span> EMA50
          </span>
          <span className="flex items-center gap-1 text-purple-300">
            <span className="w-2 h-2 rounded-full bg-purple-400"></span> EMA200
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <span className="w-2 h-2 rounded bg-amber-400"></span> POC
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded bg-emerald-400"></span> TP1
          </span>
          <span className="flex items-center gap-1 text-cyan-400">
            <span className="w-1.5 h-1.5 rounded bg-cyan-400"></span> TP2
          </span>
          <span className="flex items-center gap-1 text-purple-400">
            <span className="w-1.5 h-1.5 rounded bg-purple-400"></span> Final TP
          </span>
          <span className="flex items-center gap-1 text-rose-400">
            <span className="w-1.5 h-1.5 rounded bg-rose-400"></span> SL
          </span>
        </div>
        <div className="text-emerald-400/80 text-[9px] flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
          <span>SB Quantum 2126 Full-Width Engine (60FPS)</span>
        </div>
      </div>
    </div>
  );
};
