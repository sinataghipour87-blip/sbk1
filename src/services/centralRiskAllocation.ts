export interface CentralRiskAllocationInput {
  balance: number;
  maxStakeQuote: number;
  maxLeverage: number;
  riskBudgetPct: number;
  stopFraction: number;
}

export interface CentralRiskAllocation {
  marginCap: number;
  riskBudgetUsd: number;
  leverage: number;
  marginUsd: number;
}

export function calculateCentralRiskAllocation(
  input: CentralRiskAllocationInput,
): CentralRiskAllocation | null {
  if (
    !Number.isFinite(input.balance) ||
    input.balance <= 0 ||
    !Number.isFinite(input.maxStakeQuote) ||
    input.maxStakeQuote <= 0 ||
    !Number.isFinite(input.maxLeverage) ||
    input.maxLeverage < 1 ||
    input.maxLeverage > 20 ||
    !Number.isFinite(input.riskBudgetPct) ||
    input.riskBudgetPct <= 0 ||
    input.riskBudgetPct > 1.5 ||
    !Number.isFinite(input.stopFraction) ||
    input.stopFraction <= 0
  ) {
    return null;
  }

  const marginCap = Math.min(input.balance, input.maxStakeQuote);
  const riskBudgetUsd = marginCap * input.riskBudgetPct / 100;
  const leverageRequiredToUseCap = riskBudgetUsd / (input.stopFraction * marginCap);
  const leverage = Math.max(1, Math.min(input.maxLeverage, leverageRequiredToUseCap));
  const marginUsd = Math.min(marginCap, riskBudgetUsd / (input.stopFraction * leverage));
  if (!Number.isFinite(marginUsd) || marginUsd <= 0) return null;

  return { marginCap, riskBudgetUsd, leverage, marginUsd };
}
