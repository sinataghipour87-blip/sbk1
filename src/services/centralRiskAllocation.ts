export interface CentralRiskAllocationInput {
  balance: number;
  maxStakeQuote: number;
  maxLeverage: number;
  riskBudgetPct: number;
  stopFraction: number;
  availableRiskBudgetUsd?: number;
}

export interface CentralRiskAllocation {
  marginCap: number;
  riskBudgetUsd: number;
  leverage: number;
  marginUsd: number;
  allocatedRiskUsd: number;
}

const MIN_CENTRAL_LEVERAGE = 5;
const MAX_CENTRAL_LEVERAGE = 25;
const MIN_MARGIN_EQUITY_PCT = 2;
const MAX_MARGIN_EQUITY_PCT = 10;
const MAX_CENTRAL_RISK_BUDGET_PCT = 10;

export function calculateCentralRiskAllocation(
  input: CentralRiskAllocationInput,
): CentralRiskAllocation | null {
  if (
    !Number.isFinite(input.balance) ||
    input.balance <= 0 ||
    !Number.isFinite(input.maxStakeQuote) ||
    input.maxStakeQuote <= 0 ||
    !Number.isFinite(input.maxLeverage) ||
    input.maxLeverage < MIN_CENTRAL_LEVERAGE ||
    input.maxLeverage > MAX_CENTRAL_LEVERAGE ||
    !Number.isFinite(input.riskBudgetPct) ||
    input.riskBudgetPct <= 0 ||
    input.riskBudgetPct > MAX_CENTRAL_RISK_BUDGET_PCT ||
    !Number.isFinite(input.stopFraction) ||
    input.stopFraction <= 0
  ) {
    return null;
  }

  const marginCap = Math.min(
    input.balance * MAX_MARGIN_EQUITY_PCT / 100,
    input.maxStakeQuote,
  );
  const minimumMarginUsd = input.balance * MIN_MARGIN_EQUITY_PCT / 100;
  const configuredRiskBudgetUsd = input.balance * input.riskBudgetPct / 100;
  const riskBudgetUsd = input.availableRiskBudgetUsd === undefined
    ? configuredRiskBudgetUsd
    : Math.min(configuredRiskBudgetUsd, input.availableRiskBudgetUsd);
  if (
    !Number.isFinite(riskBudgetUsd) ||
    riskBudgetUsd <= 0 ||
    !Number.isFinite(marginCap) ||
    marginCap < minimumMarginUsd
  ) return null;
  const marginAtMinimumLeverage = riskBudgetUsd / (input.stopFraction * MIN_CENTRAL_LEVERAGE);
  const marginUsd = Math.min(marginCap, marginAtMinimumLeverage);
  if (!Number.isFinite(marginUsd) || marginUsd < minimumMarginUsd) return null;
  const leverage = Math.min(
    input.maxLeverage,
    riskBudgetUsd / (input.stopFraction * marginUsd),
  );
  if (!Number.isFinite(leverage) || leverage < MIN_CENTRAL_LEVERAGE) return null;

  return {
    marginCap,
    riskBudgetUsd,
    leverage,
    marginUsd,
    allocatedRiskUsd: Math.min(riskBudgetUsd, marginUsd * leverage * input.stopFraction),
  };
}
