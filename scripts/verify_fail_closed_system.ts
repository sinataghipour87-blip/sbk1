import assert from 'assert';

// Polyfill localStorage and fetch for Node test environment
const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();
(globalThis as any).localStorage = storageMock;
(globalThis as any).fetch = async () => { throw new Error('Network failure (simulated python/exchange down)'); };

import { hunterExecutionEngine } from '../src/services/hunterExecutionEngine';
import { orderFlowEngine } from '../src/services/orderFlowEngine';
import { computeCentralCalibratedProbability } from '../src/services/centralProbabilityEngine';
import { runPreTradeRiskGate } from '../src/services/autoTradeGuard';
import { riskEngine } from '../src/services/productionGateThreeLayerEngine';
import { MissingDataIntegrityGuardService } from '../src/services/missingDataIntegrityGuard';

console.log('🧪 Starting Quantum Trade AI Fail-Closed & Hunter Execution Integration Tests...');

async function runTests() {
  // Test 1: Hunter Execution Engine with NEUTRAL signal -> NO TRADE
  const execResult = await hunterExecutionEngine.executeHunterOrder({
    symbol: 'BTCUSDT',
    timestamp: Date.now(),
    direction: 'NEUTRAL',
    setupType: 'NONE',
    sweptLevelPrice: 0,
    entryPrice: 88000,
    invalidationStopLoss: 0,
    takeProfitTarget1: 0,
    takeProfitTarget2: 0,
    riskRewardRatio: 0,
    cvdDivergenceConfirmed: false,
    orderbookAbsorptionRatio: 0,
    signalConfidencePct: 0,
    rationaleFa: 'Test',
  });

  assert.strictEqual(execResult.status, 'NO_TRADE', 'Neutral signal must return NO_TRADE');
  console.log('✅ Test 1 Passed: Neutral Signal Returns NO_TRADE.');

  // Test 2: Hunter Execution Engine with unconfirmed CVD / Absorption -> NO TRADE
  const unconfirmedExec = await hunterExecutionEngine.executeHunterOrder({
    symbol: 'BTCUSDT',
    timestamp: Date.now(),
    direction: 'LONG',
    setupType: 'BULLISH_LIQUIDITY_SWEEP',
    sweptLevelPrice: 87500,
    entryPrice: 88000,
    invalidationStopLoss: 87400,
    takeProfitTarget1: 89500,
    takeProfitTarget2: 91000,
    riskRewardRatio: 2.5,
    cvdDivergenceConfirmed: false, // NOT CONFIRMED
    orderbookAbsorptionRatio: 0.2, // WEAK ABSORPTION
    signalConfidencePct: 40,
    rationaleFa: 'Unconfirmed entry',
  });
  assert.strictEqual(unconfirmedExec.status, 'NO_TRADE', 'Unconfirmed CVD/Absorption must be rejected as NO_TRADE');
  console.log('✅ Test 2 Passed: Unconfirmed Setup Safely Blocked (NO_TRADE).');

  // Test 3: MissingDataIntegrityGuard blocks null / missing market data
  const missingGuard = MissingDataIntegrityGuardService.getInstance();
  const feedAudit = missingGuard.auditMarketDataIntegrity(null);
  assert.strictEqual(feedAudit.isTradePermitted, false, 'Missing data must prohibit trades');
  assert.strictEqual(feedAudit.criticalFeaturesAvailable, false, 'Critical features must be reported as unavailable');
  console.log('✅ Test 3 Passed: Missing Data Integrity Guard Rejects NULL Analysis.');

  // Test 4: Pre-Trade Risk Gate Fails Closed on Missing Data (Rule Zero)
  const riskGateNull = runPreTradeRiskGate(null, [], []);
  assert.strictEqual(riskGateNull.allPassed, false, 'Pre-trade risk gate must fail closed when analysis is null');
  assert.strictEqual(riskGateNull.status, 'ORDER_BLOCKED', 'Pre-trade risk gate status must be ORDER_BLOCKED');
  console.log('✅ Test 4 Passed: Pre-Trade Risk Gate Fails Closed on NULL Feed.');

  // Test 5: Pre-Trade Risk Gate Fails Closed when Win Probability is Uncalibrated / Null
  const mockAnalysis: any = {
    price: 88000,
    dataStatus: 'LIVE',
    canonicalSnapshot: {
      timestampUtc: Date.now(),
      basisSpreadBps: 2.5,
    },
    signalOk: true,
    entryTiming: 'IMMEDIATE',
    calibratedWinProb: null, // Strictly uncalibrated
  };
  const riskGateUncalibrated = runPreTradeRiskGate(mockAnalysis, [], [], {
    side: 'LONG',
    qty: 0.1,
    price: 88000,
    stopLoss: 87000,
    takeProfit: 91000,
    availableBalanceUsdt: 5000,
    winProb: null, // No fabricated probability
    expectedValue: null,
  });
  assert.strictEqual(riskGateUncalibrated.allPassed, false, 'Uncalibrated / null probability must fail allPassed');
  assert.strictEqual(riskGateUncalibrated.status, 'ORDER_BLOCKED', 'Uncalibrated / null probability must block order');
  console.log('✅ Test 5 Passed: Zero-Fabricated Probability Enforced (ORDER_BLOCKED).');

  // Test 6: OrderFlowEngine detects zero sweep on empty candle array
  const flowSnapshot = orderFlowEngine.analyzeOrderFlowAndLiquidity([], null, null);
  assert.strictEqual(flowSnapshot.activeSignal.direction, 'NEUTRAL', 'Empty candles must yield NEUTRAL direction');
  console.log('✅ Test 6 Passed: Liquidity Sweep Engine with Empty Data Returns NEUTRAL.');

  // Test 7: CentralProbabilityEngine returns uncalibrated when no dataset exists
  const probCheck = computeCentralCalibratedProbability({
    trendBias: 'NEUTRAL',
    scoreLong: 50,
    scoreShort: 50,
    hurst: 0.5,
    adx: 22,
    rsi: 45,
    volatilityPct: 1.5,
    obi: 0.1,
    marketRegime: 'RANGING',
  });
  assert.strictEqual(probCheck.isCalibrationVerified, false, 'Unverified dataset must mark isCalibrationVerified as false');
  console.log('✅ Test 7 Passed: Central Probability Engine Refuses to Fabricate Verification.');

  // Test 8: ProductionGateThreeLayerEngine Blocks Execution on Incomplete Gate Criteria
  const gateVerdict = riskEngine.evaluateRiskGate({
    predictionId: 'PRED_TEST',
    generatedAt: Date.now(),
    symbol: 'BTCUSDT',
    direction: 'LONG',
    setupType: 'SWEEP',
    entryTarget: 88000,
    stopLoss: 87500,
    takeProfit1: 89500,
    takeProfit2: 91000,
    takeProfit3: 92000,
    calibratedProbabilityPct: null, // Uncalibrated
    expectedValueUsd: null,
    confidenceInterval: null,
    signalOk: false,
    modelVersion: 'v1',
    rawAnalysis: null,
  }, { availableBalanceUsdt: 1000, maxEquityUsd: 1000, currentEquityUsd: 1000 }, [], []);
  assert.strictEqual(gateVerdict.isApproved, false, 'Incomplete gate criteria must reject trade');
  assert.strictEqual(gateVerdict.decision, 'NO_TRADE', 'Decision must strictly be NO_TRADE');
  console.log('✅ Test 8 Passed: 3-Layer Production Gate Fails Closed (NO_TRADE).');

  console.log('🎉 All Hunter & Production-Grade Tests Passed Successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
