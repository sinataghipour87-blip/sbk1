import assert from 'node:assert/strict';
import type { AnalysisResult } from '../src/types/trading';
import {
  evaluateEightMemberCouncil,
  type EightMemberCouncilReport,
} from '../src/services/eightMemberCouncil';
import { runPostCouncilTradeControl } from '../src/services/postCouncilTradeController';
import { calculateCentralRiskAllocation } from '../src/services/centralRiskAllocation';
import type { MultiBrainConsensusReport } from '../src/services/multiBrainEnsemble';

const tightStopAllocation = calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  stopFraction: 0.002,
});
assert.ok(tightStopAllocation);
assert.equal(tightStopAllocation.leverage, 5);
assert.equal(tightStopAllocation.marginUsd, 100);
assert.ok(
  tightStopAllocation.marginUsd * tightStopAllocation.leverage * 0.002 <=
    tightStopAllocation.riskBudgetUsd,
);

const wideStopAllocation = calculateCentralRiskAllocation({
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 0.1,
  stopFraction: 0.02,
});
assert.ok(wideStopAllocation);
assert.equal(wideStopAllocation.leverage, 1);
assert.equal(wideStopAllocation.marginUsd, 5);
assert.ok(wideStopAllocation.marginUsd < 5.01, 'wide stops must shrink margin to remain within budget');
assert.equal(calculateCentralRiskAllocation({
  balance: 0,
  maxStakeQuote: 100,
  maxLeverage: 5,
  riskBudgetPct: 1,
  stopFraction: 0.01,
}), null);

const noQuorumCouncil = evaluateEightMemberCouncil({ nowMs: Date.now() });
const noQuorum = runPostCouncilTradeControl({
  analysis: {} as AnalysisResult,
  council: noQuorumCouncil,
  multiBrainReport: {} as MultiBrainConsensusReport,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 1,
  riskBudgetPct: 0.1,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  minWinProbability: 68,
});
assert.equal(noQuorum.approved, false);
assert.equal(noQuorum.decision, undefined, 'the trade pipeline must not run without council quorum');
assert.equal(noQuorum.tradeContract, undefined);

const quorumCouncil: EightMemberCouncilReport = {
  ...noQuorumCouncil,
  members: noQuorumCouncil.members.map((member, index) => ({
    ...member,
    vote: index === 0 ? 'ABSTAIN' as const : index <= 5 ? 'LONG' as const : 'ABSTAIN' as const,
  })),
  longVotes: 5,
  shortVotes: 0,
  neutralVotes: 0,
  abstentions: 3,
  quorumMet: true,
  selectedDirection: 'LONG',
};
const invalidBalance = runPostCouncilTradeControl({
  analysis: {} as AnalysisResult,
  council: quorumCouncil,
  multiBrainReport: {} as MultiBrainConsensusReport,
  balance: 0,
  maxStakeQuote: 0,
  maxLeverage: 1,
  riskBudgetPct: 0.1,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  minWinProbability: 68,
});
assert.equal(invalidBalance.approved, false);
assert.equal(invalidBalance.decision, undefined, 'invalid account risk inputs must stop before the pipeline');

const missingOwnerEvidence = runPostCouncilTradeControl({
  analysis: {} as AnalysisResult,
  council: quorumCouncil,
  multiBrainReport: {} as MultiBrainConsensusReport,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 1,
  riskBudgetPct: 0.1,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  minWinProbability: 68,
});
assert.equal(missingOwnerEvidence.approved, false);
assert.equal(missingOwnerEvidence.decision, undefined, 'central control must not rerun delegated analysis when the owner abstains');
assert.match(missingOwnerEvidence.reason, /1/);

const inconsistentQuorum = runPostCouncilTradeControl({
  analysis: {} as AnalysisResult,
  council: { ...quorumCouncil, longVotes: 4 },
  multiBrainReport: {} as MultiBrainConsensusReport,
  balance: 1_000,
  maxStakeQuote: 100,
  maxLeverage: 1,
  riskBudgetPct: 0.1,
  referencePrice: 60_000,
  maxDeviationBps: 100,
  minWinProbability: 68,
});
assert.equal(inconsistentQuorum.approved, false);
assert.equal(inconsistentQuorum.decision, undefined, 'a claimed quorum must match the eight member votes');

console.log('Post-council single-control fail-closed checks passed.');
