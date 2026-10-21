import type {
  AnalysisResult,
  DecisionPipelineResult,
  TradeContract,
} from '../types/trading';
import type { EightMemberCouncilReport } from './eightMemberCouncil';
import type { MultiBrainConsensusReport } from './multiBrainEnsemble';
import { runUnifiedDecisionPipeline } from './decisionPipeline';

export interface PostCouncilTradeControlInput {
  analysis: AnalysisResult;
  council: EightMemberCouncilReport;
  multiBrainReport: MultiBrainConsensusReport;
  balance: number;
  maxStakeQuote: number;
  maxLeverage: number;
  riskBudgetPct: number;
  referencePrice: number;
  maxDeviationBps: number;
  minWinProbability: number;
}

export interface PostCouncilTradeControlResult {
  approved: boolean;
  reason: string;
  decision?: DecisionPipelineResult;
  tradeContract?: TradeContract;
  executionRisk?: {
    maxStakeQuote: number;
    maxLeverage: number;
  };
}

export function runPostCouncilTradeControl(
  input: PostCouncilTradeControlInput,
): PostCouncilTradeControlResult {
  const direction = input.council.selectedDirection;
  const votes = input.council.members.map(({ vote }) => vote);
  const actualLongVotes = votes.filter((vote) => vote === 'LONG').length;
  const actualShortVotes = votes.filter((vote) => vote === 'SHORT').length;
  const actualNeutralVotes = votes.filter((vote) => vote === 'NEUTRAL').length;
  const actualAbstentions = votes.filter((vote) => vote === 'ABSTAIN').length;
  const memberIds = new Set(input.council.members.map(({ id }) => id));
  const expectedDirection = actualLongVotes >= 5
    ? 'LONG'
    : actualShortVotes >= 5
      ? 'SHORT'
      : null;
  const validCouncilReport = input.council.quorumRequired === 5 &&
    input.council.members.length === 8 &&
    memberIds.size === 8 &&
    [1, 2, 3, 4, 5, 6, 7, 8].every((id) => memberIds.has(id)) &&
    input.council.longVotes === actualLongVotes &&
    input.council.shortVotes === actualShortVotes &&
    input.council.neutralVotes === actualNeutralVotes &&
    input.council.abstentions === actualAbstentions &&
    input.council.quorumMet === (expectedDirection !== null) &&
    input.council.selectedDirection === expectedDirection;
  if (!validCouncilReport || !input.council.quorumMet || !direction) {
    return {
      approved: false,
      reason: 'The council report is inconsistent or its verified 5-of-8 quorum was not met; the central trade control did not run.',
    };
  }

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
    input.riskBudgetPct > 1.5
  ) {
    return {
      approved: false,
      reason: 'Valid balance, stake cap, and leverage cap are required by the central trade control.',
    };
  }
  if (
    !Number.isFinite(input.referencePrice) ||
    input.referencePrice <= 0 ||
    !Number.isFinite(input.maxDeviationBps) ||
    input.maxDeviationBps <= 0
  ) {
    return {
      approved: false,
      reason: 'A valid reference price and entry-deviation limit are required by the central trade control.',
    };
  }

  const missingCouncilAnalysis = [1, 2, 3].filter((memberId) =>
    !input.council.members.some((member) =>
      member.id === memberId && member.vote !== 'ABSTAIN'
    )
  );
  if (missingCouncilAnalysis.length > 0) {
    return {
      approved: false,
      reason: `Central control did not repeat council-owned analysis; required member evidence is missing or abstained: ${missingCouncilAnalysis.join(', ')}.`,
    };
  }

  const analysis: AnalysisResult = { ...input.analysis, direction };
  const decision = runUnifiedDecisionPipeline({
    analysis,
    targetDirection: direction,
    authoritativeDirection: direction,
    council: input.council,
    multiBrainReport: input.multiBrainReport,
    balance: input.balance,
    userLeverage: input.maxLeverage,
    centralRiskControl: {
      maxStakeQuote: input.maxStakeQuote,
      riskBudgetPct: input.riskBudgetPct,
      maxLeverage: input.maxLeverage,
    },
    minWinProbability: input.minWinProbability,
    isAutoTrade: true,
  });
  const tradeContract = decision.tradeContract;
  const approved = decision.decision === 'EXECUTE_APPROVED' &&
    decision.masterDecision?.executionPermitted === true &&
    tradeContract?.contractStatus === 'APPROVED_EXECUTABLE' &&
    tradeContract.direction === direction;

  if (!approved || !tradeContract) {
    return {
      approved: false,
      reason: decision.waitReasonFa || 'The central trade control rejected the proposed trade.',
      decision,
    };
  }

  const stopFraction = Math.abs(tradeContract.entryZone.target - tradeContract.stop) /
    tradeContract.entryZone.target;
  if (!Number.isFinite(stopFraction) || stopFraction <= 0) {
    return {
      approved: false,
      reason: 'The central trade control produced an invalid stop distance.',
      decision,
    };
  }
  const maxStakeQuote = Math.min(
    input.maxStakeQuote,
    tradeContract.positionSize.marginUsd * stopFraction *
      tradeContract.leverage / (input.riskBudgetPct / 100),
  );
  const maxLeverage = Math.min(input.maxLeverage, tradeContract.leverage);
  if (
    !Number.isFinite(maxStakeQuote) ||
    maxStakeQuote <= 0 ||
    !Number.isFinite(maxLeverage) ||
    maxLeverage < 1
  ) {
    return {
      approved: false,
      reason: 'The central trade control produced invalid margin or leverage limits.',
      decision,
    };
  }
  const entryDeviationBps = Math.abs(
    tradeContract.entryZone.target - input.referencePrice,
  ) / input.referencePrice * 10_000;
  if (entryDeviationBps > input.maxDeviationBps) {
    return {
      approved: false,
      reason: `Central trade control rejected entry deviation ${entryDeviationBps.toFixed(2)} bps; limit is ${input.maxDeviationBps} bps.`,
      decision,
    };
  }

  return {
    approved: true,
    reason: 'The council and the single central post-council trade control approved the same direction.',
    decision,
    tradeContract,
    executionRisk: { maxStakeQuote, maxLeverage },
  };
}
