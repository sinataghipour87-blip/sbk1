import assert from 'node:assert/strict';
import type { DecisionPipelineStageState } from '../src/types/trading';
import {
  areRequiredDecisionStagesSatisfied,
  countEligibleIndependentModels,
  hasValidCouncilDelegationEvidence,
  isCouncilDelegatedStageId,
} from '../src/services/decisionPipeline';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
import type { IndependentModelPrediction } from '../src/services/multiBrainEnsemble';

function stage(
  id: DecisionPipelineStageState['id'],
  status: DecisionPipelineStageState['status'],
  passed: boolean,
): DecisionPipelineStageState {
  return {
    id,
    name: id,
    nameFa: id,
    status,
    passed,
    value: status,
    threshold: 'test',
    reasonFa: 'test fixture',
  };
}

const passedStages = [
  stage('STAGE_1_MARKET_DATA', 'PASSED', true),
  stage('STAGE_8_ENTRY_TRIGGER', 'PASSED', true),
];
assert.equal(areRequiredDecisionStagesSatisfied(passedStages, false), true);
assert.equal(
  areRequiredDecisionStagesSatisfied([
    ...passedStages,
    stage('STAGE_4_HTF_STRUCTURE', 'SKIPPED', false),
  ], true),
  true,
  'only the HTF check delegated to a validated council may be skipped',
);
assert.equal(
  areRequiredDecisionStagesSatisfied([
    ...passedStages,
    stage('STAGE_4_HTF_STRUCTURE', 'SKIPPED', false),
  ], false),
  false,
  'a delegated stage without valid council evidence must block',
);
assert.equal(
  areRequiredDecisionStagesSatisfied([
    ...passedStages,
    stage('STAGE_1_MARKET_DATA', 'SKIPPED', false),
  ], true),
  false,
  'mandatory safety stages are never made optional by delegation',
);
assert.equal(
  areRequiredDecisionStagesSatisfied([
    ...passedStages,
    stage('STAGE_4_HTF_STRUCTURE', 'FAILED', false),
  ], true),
  false,
  'a genuine failed stage blocks even with a valid council',
);
assert.equal(
  areRequiredDecisionStagesSatisfied([
    ...passedStages,
    stage('STAGE_4_HTF_STRUCTURE', 'PASSED', false),
  ], true),
  false,
  'inconsistent status and passed fields fail closed',
);
assert.equal(isCouncilDelegatedStageId('STAGE_4_HTF_STRUCTURE'), true);
assert.equal(isCouncilDelegatedStageId('STAGE_1_MARKET_DATA'), false);

const emptyCouncil = evaluateEightMemberCouncil({ nowMs: Date.now() });
const council = {
  ...emptyCouncil,
  members: emptyCouncil.members.map((member) => ({
    ...member,
    vote: member.id <= 5 ? 'LONG' as const : 'ABSTAIN' as const,
  })),
  longVotes: 5,
  shortVotes: 0,
  weightedLongVotes: 5,
  weightedShortVotes: 0,
  neutralVotes: 0,
  abstentions: 3,
  selectedDirection: 'LONG' as const,
  quorumMet: true,
};
assert.equal(hasValidCouncilDelegationEvidence(council), true);
assert.equal(hasValidCouncilDelegationEvidence({
  ...council,
  longVotes: council.longVotes - 1,
}), false, 'inconsistent vote totals cannot authorize delegated stages');
assert.equal(hasValidCouncilDelegationEvidence({
  ...council,
  members: council.members.slice(1),
}), false, 'a council report without all eight unique members cannot authorize delegation');

const eligibleModel: IndependentModelPrediction = {
  modelId: 'test-model',
  nameFa: 'test',
  prediction: 'BULLISH',
  rawProbabilityPct: 70,
  historicalPrecisionPct: 60,
  sampleSize: 40,
  calibrationFactor: 1,
  regimePerformancePct: 60,
  healthState: 'HEALTHY',
  independenceValidated: true,
  correlationWithOtherModels: 0.2,
  effectiveWeight: 0.5,
};
assert.equal(countEligibleIndependentModels([
  eligibleModel,
  { ...eligibleModel, modelId: 'test-model-2' },
], 'LONG'), 2);
assert.equal(countEligibleIndependentModels([
  eligibleModel,
  { ...eligibleModel, modelId: 'unvalidated', independenceValidated: false },
], 'LONG'), 1);
assert.equal(countEligibleIndependentModels([
  { ...eligibleModel, effectiveWeight: 0 },
  { ...eligibleModel, modelId: 'under-sampled', sampleSize: 34 },
], 'LONG'), 0);
assert.equal(countEligibleIndependentModels([
  { ...eligibleModel, prediction: 'BEARISH' },
  { ...eligibleModel, modelId: 'uncalibrated', historicalPrecisionPct: 54 },
], 'LONG'), 0);

console.log('Decision pipeline skipped-stage and independent-ensemble safety checks passed.');
