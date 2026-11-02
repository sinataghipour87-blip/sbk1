import assert from 'node:assert/strict';
import { checkCouncilMemberSources } from '../src/services/councilSourceHealth';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
import { getCouncilMemberSources } from '../src/services/councilSourceRegistry';
import { fetchOnChainWhaleData } from '../src/services/publicBitcoinWhaleData';

const assets = ['BTC', 'SOL', 'XRP', 'BNB'] as const;
const liveVerificationStartedAtMs = Date.now();
console.log(`[LIVE API VERIFICATION] startedAt=${new Date(liveVerificationStartedAtMs).toISOString()}`);
const minimumHealthySources: Readonly<Record<number, number>> = {
  1: 2,
  2: 2,
  3: 2,
  4: 2,
};

for (const asset of assets) {
  console.log(`[LIVE API VERIFICATION] asset=${asset} startedAt=${new Date().toISOString()}`);
  const pair = `${asset}/USDT:USDT`;
  const whaleFlowData = await fetchOnChainWhaleData({
    pair,
    priceUsd: null,
    forceRefresh: true,
  });
  const checksByMember = await checkCouncilMemberSources(
    Date.now(),
    fetch,
    asset,
    whaleFlowData,
  );
  const report = evaluateEightMemberCouncil({
    pair,
    whaleFlowData,
    memberSourceChecks: checksByMember,
    requireMemberSourceQuorum: true,
  });

  for (const memberId of [1, 2, 3, 4]) {
    const sources = getCouncilMemberSources(memberId, asset);
    const checks = checksByMember[memberId] ?? [];
    const expectedCount = memberId === 2 ? asset === 'BNB' ? 5 : 6 : 4;
    assert.equal(sources.length, expectedCount, `${asset} member ${memberId} has registered source entries`);
    assert.equal(checks.length, expectedCount, `${asset} member ${memberId} checked every registered entry`);
    if (memberId === 2) {
      const gateCheck = checks.find(({ sourceId }) =>
        sourceId === `council.member2.${asset}.gateio-trades`
      );
      assert.ok(gateCheck, `${asset} Gate spot trades were checked`);
      assert.equal(gateCheck.status, 'HEALTHY', `${asset} Gate spot trade response is live and valid`);
      assert.equal(gateCheck.dataValid, true, `${asset} Gate spot CVD passed validation`);
      assert.equal(gateCheck.normalizedData?.marketType, 'spot');
      assert.equal(gateCheck.normalizedData?.independenceGroup, 'gateio');
      assert.ok(Number(gateCheck.normalizedData?.classifiedTradeCount) >= 5);
      assert.equal(gateCheck.normalizedData?.cvdWindowMs, 5 * 60_000);
      assert.ok(Number(gateCheck.normalizedData?.tradeTimestampMs) <= Date.now());
      assert.equal(
        Number(gateCheck.normalizedData?.cvdBase),
        Number(gateCheck.normalizedData?.buyVolumeBase) -
          Number(gateCheck.normalizedData?.sellVolumeBase),
      );
      assert.equal(gateCheck.normalizedData?.volumeUnit, `${asset} base units`);
    }
    const healthyChecks = checks.filter(({ status, dataValid }) =>
      status === 'HEALTHY' && dataValid === true
    );
    const healthyCount = memberId === 2
      ? new Set(healthyChecks.map(({ marketType, independenceGroup, sourceId }) =>
        `${marketType ?? 'unknown'}:${independenceGroup ?? sourceId}`
      )).size
      : healthyChecks.length;
    const minimum = minimumHealthySources[memberId];
    const vote = report.members.find((member) => member.id === memberId);
    assert.ok(vote, `${asset} member ${memberId} vote is present`);
    const usedSourceIds = vote.sourceChecks
      .filter(({ voteUsage }) => voteUsage === 'USED')
      .map(({ sourceId }) => sourceId);
    const abstainedEvidenceIds = vote.sourceChecks
      .filter(({ voteUsage }) => voteUsage === 'ABSTAINED')
      .map(({ sourceId }) => sourceId);
    if (memberId === 2) {
      const sourceDefinitions = new Map(
        getCouncilMemberSources(2, asset).map((source) => [source.id, source]),
      );
      const signalsByMarket = new Map<string, Map<string, { sourceId: string; ratio: number }>>();
      for (const check of healthyChecks) {
        if (check.marketType !== 'spot' && check.marketType !== 'futures') continue;
        const values = check.normalizedData;
        const cvd = values?.cvdBase ?? values?.cvdEth;
        const buyVolume = values?.buyVolumeBase ?? values?.buyVolumeEth;
        const sellVolume = values?.sellVolumeBase ?? values?.sellVolumeEth;
        const classifiedTradeCount = values?.classifiedTradeCount;
        const timestampMs = values?.tradeTimestampMs;
        const totalVolume = Number(buyVolume) + Number(sellVolume);
        const maxAgeMs = sourceDefinitions.get(check.sourceId)?.maxAgeMs ?? 60_000;
        if (
          typeof cvd !== 'number' || typeof buyVolume !== 'number' ||
          typeof sellVolume !== 'number' || typeof timestampMs !== 'number' ||
          typeof classifiedTradeCount !== 'number' ||
          !Number.isFinite(cvd) || !Number.isFinite(totalVolume) || totalVolume <= 0 ||
          !Number.isFinite(classifiedTradeCount) ||
          Math.abs(cvd - (buyVolume - sellVolume)) > Math.max(1e-8, totalVolume * 1e-9) ||
          classifiedTradeCount < 5 ||
          values?.cvdWindowMs !== 5 * 60_000 ||
          timestampMs > Date.now() + 1_000 ||
          Date.now() - timestampMs > maxAgeMs
        ) continue;
        const venue = check.independenceGroup ?? check.provider ?? check.sourceId;
        const signals = signalsByMarket.get(check.marketType) ?? new Map();
        if (!signals.has(venue)) signals.set(venue, { sourceId: check.sourceId, ratio: cvd / totalVolume });
        signalsByMarket.set(check.marketType, signals);
      }
      const qualifiedMarkets = [...signalsByMarket.values()]
        .filter((signals) => signals.size >= minimum);
      const directionalVotes = new Set(qualifiedMarkets.map((signals) => {
        const ratio = [...signals.values()].reduce((sum, signal) => sum + signal.ratio, 0) / signals.size;
        return ratio >= 0.05 ? 'LONG' : ratio <= -0.05 ? 'SHORT' : 'NEUTRAL';
      }).filter((direction) => direction !== 'NEUTRAL'));
      const expectedAbstain = qualifiedMarkets.length === 0 || directionalVotes.size > 1;
      assert.equal(
        vote.vote === 'ABSTAIN',
        expectedAbstain,
        `${asset} member 2 must abstain without same-market quorum or when qualified spot/futures directions conflict.`,
      );
      if (expectedAbstain) {
        assert.equal(usedSourceIds.length, 0, `${asset} member 2 abstentions must not claim used sources.`);
      } else {
        const expectedSourceIds = qualifiedMarkets.flatMap((signals) =>
          [...signals.values()].map(({ sourceId }) => sourceId)
        ).sort();
        assert.deepEqual([...usedSourceIds].sort(), expectedSourceIds);
      }
    } else {
      assert.ok(
        healthyCount >= minimum,
        `${asset} member ${memberId} has ${healthyCount}/${expectedCount} healthy sources; needs ${minimum}.`,
      );
      assert.notEqual(
        vote.vote,
        'ABSTAIN',
        `${asset} member ${memberId} must vote with its verified live sources.`,
      );
    }
    console.log(
      `${asset} | member ${memberId} | ${healthyCount}/${expectedCount} healthy | ${vote.vote} | used=${usedSourceIds.join(',') || 'none'} | abstainedEvidence=${abstainedEvidenceIds.join(',') || 'none'} | source=${vote.sourceId ?? 'none'} | fallback=${vote.fallbackSourceId ?? 'none'}`,
    );
    for (const check of checks) {
      const reportCheck = vote.sourceChecks.find(({ sourceId }) => sourceId === check.sourceId) ?? check;
      console.log(
        `  ${reportCheck.sourceId} | provider=${reportCheck.provider ?? 'unknown'} | endpoint=${reportCheck.endpoint ?? 'unknown'} | asset=${asset} | market=${reportCheck.marketType ?? 'unknown'} | fetchedAt=${reportCheck.observedAtMs === null || reportCheck.observedAtMs === undefined ? 'unknown' : new Date(reportCheck.observedAtMs).toISOString()} | dataAt=${reportCheck.sourceTimestampMs === null || reportCheck.sourceTimestampMs === undefined ? 'unknown' : new Date(reportCheck.sourceTimestampMs).toISOString()} | ${reportCheck.status} | HTTP=${reportCheck.httpHealthy} | data=${reportCheck.dataValid} | voteUsage=${reportCheck.voteUsage ?? 'unknown'} | ${reportCheck.dataDetail ?? reportCheck.detail}`,
      );
    }
  }

  const optionSources = getCouncilMemberSources(5, asset);
  const optionChecks = checksByMember[5] ?? [];
  assert.equal(
    optionChecks.length,
    optionSources.length,
    `${asset} member 5 checks every registered options source`,
  );
  const directionalChecks = optionChecks.filter(({ status, dataValid, voteValue }) =>
    status === 'HEALTHY' && dataValid === true && voteValue === 'USEFUL'
  );
  const directionalCount = new Set(directionalChecks.map(({ independenceGroup, provider, sourceId }) =>
    independenceGroup ?? provider ?? sourceId
  )).size;
  const optionsVote = report.members.find((member) => member.id === 5);
  assert.ok(optionsVote, `${asset} member 5 vote is present`);
  const usedOptionSourceIds = optionsVote.sourceChecks
    .filter(({ voteUsage }) => voteUsage === 'USED')
    .map(({ sourceId }) => sourceId);
  const abstainedOptionEvidenceIds = optionsVote.sourceChecks
    .filter(({ voteUsage }) => voteUsage === 'ABSTAINED')
    .map(({ sourceId }) => sourceId);
  if (optionsVote.vote === 'ABSTAIN') {
    assert.equal(
      usedOptionSourceIds.length,
      0,
      `${asset} member 5 must not report option evidence as used when it abstains.`,
    );
  } else {
    assert.ok(
      directionalCount >= 2 && usedOptionSourceIds.length >= 2,
      `${asset} member 5 may vote only when at least two independent directional venues were actually selected.`,
    );
  }
  console.log(
    `${asset} | member 5 | ${optionChecks.filter(({ status, dataValid }) => status === 'HEALTHY' && dataValid === true).length}/${optionSources.length} healthy | ${directionalCount} directional | ${optionsVote.vote} | used=${usedOptionSourceIds.join(',') || 'none'} | abstainedEvidence=${abstainedOptionEvidenceIds.join(',') || 'none'} | source=${optionsVote.sourceId ?? 'none'} | fallback=${optionsVote.fallbackSourceId ?? 'none'}`,
  );
  for (const check of optionChecks) {
    const reportCheck = optionsVote.sourceChecks.find(({ sourceId }) => sourceId === check.sourceId) ?? check;
    console.log(
      `  ${reportCheck.sourceId} | provider=${reportCheck.provider ?? 'unknown'} | endpoint=${reportCheck.endpoint ?? 'unknown'} | asset=${asset} | market=${reportCheck.marketType ?? 'unknown'} | fetchedAt=${reportCheck.observedAtMs === null || reportCheck.observedAtMs === undefined ? 'unknown' : new Date(reportCheck.observedAtMs).toISOString()} | dataAt=${reportCheck.sourceTimestampMs === null || reportCheck.sourceTimestampMs === undefined ? 'unknown' : new Date(reportCheck.sourceTimestampMs).toISOString()} | ${reportCheck.status} | HTTP=${reportCheck.httpHealthy} | data=${reportCheck.dataValid} | voteValue=${reportCheck.voteValue} | voteUsage=${reportCheck.voteUsage ?? 'unknown'} | ${reportCheck.dataDetail ?? reportCheck.detail}`,
    );
  }

  const onChainSources = getCouncilMemberSources(6, asset);
  const onChainChecks = checksByMember[6] ?? [];
  const onChainVote = report.members.find((member) => member.id === 6);
  assert.ok(onChainVote, `${asset} member 6 vote is present`);
  assert.equal(onChainChecks.length, onChainSources.length);
  const healthyOnChainCount = onChainChecks.filter(({ status }) => status === 'HEALTHY').length;
  const directionalOnChainCount = onChainChecks.filter(({ status, dataValid, voteValue }) =>
    status === 'HEALTHY' && dataValid === true && voteValue === 'USEFUL'
  ).length;
  assert.ok(
    directionalOnChainCount < 2,
    `${asset} has fewer than two independently verified, direction-bearing on-chain sources.`,
  );
  assert.equal(
    onChainVote.vote,
    'ABSTAIN',
    `${asset} member 6 must abstain without two valid directional on-chain metrics.`,
  );
  console.log(
    `${asset} | member 6 | ${healthyOnChainCount}/${onChainSources.length} healthy, ${directionalOnChainCount} directional | ${onChainVote.vote} | source=${onChainVote.sourceId ?? 'none'} | fallback=${onChainVote.fallbackSourceId ?? 'none'} | ${whaleFlowData.status}: ${whaleFlowData.unavailableReason ?? whaleFlowData.provider}`,
  );
  for (const check of onChainChecks) {
    console.log(`  ${check.sourceId} | ${check.status} | ${check.dataDetail ?? check.detail}`);
  }

  const macroSources = getCouncilMemberSources(7, asset);
  const macroChecks = checksByMember[7] ?? [];
  const macroVote = report.members.find((member) => member.id === 7);
  assert.equal(macroSources.length, 4, `${asset} member 7 has four shared macro slots`);
  assert.equal(macroChecks.length, macroSources.length);
  assert.ok(macroSources.every(({ dataType }) =>
    dataType.startsWith('shared macro; not asset-specific.')
  ));
  assert.ok(macroVote, `${asset} member 7 vote is present`);
  const independentMacroSignals = macroChecks.filter(({ sourceId, status, dataValid, normalizedData }) =>
    sourceId !== 'council.member7.fred-market-series' &&
    status === 'HEALTHY' && dataValid === true &&
    typeof normalizedData?.macroDirectionValue === 'number'
  ).length;
  assert.ok(
    independentMacroSignals < 2 || macroVote.vote !== 'ABSTAIN',
    `${asset} member 7 should vote when two independent live macro indicators exist.`,
  );
  console.log(
    `${asset} | member 7 | ${macroChecks.filter(({ status, dataValid }) => status === 'HEALTHY' && dataValid === true).length}/4 healthy shared sources | ${independentMacroSignals} independent directional | ${macroVote.vote} | source=${macroVote.sourceId ?? 'none'} | fallback=${macroVote.fallbackSourceId ?? 'none'}`,
  );
  for (const check of macroChecks) {
    console.log(`  ${check.sourceId} | ${check.status} | ${check.dataDetail ?? check.detail}`);
  }

  const newsSources = getCouncilMemberSources(8, asset);
  const newsChecks = checksByMember[8] ?? [];
  const newsVote = report.members.find((member) => member.id === 8);
  assert.equal(newsSources.length, 4, `${asset} member 8 has four asset-specific feeds`);
  assert.equal(newsChecks.length, newsSources.length);
  assert.ok(newsVote, `${asset} member 8 vote is present`);
  const publisherNames = new Set<string>();
  for (const check of newsChecks) {
    const serialized = check.normalizedData?.rssAssetItemsJson;
    if (typeof serialized !== 'string') continue;
    const items: unknown = JSON.parse(serialized);
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item === 'object' && item !== null && 'publisher' in item &&
          typeof item.publisher === 'string') {
        publisherNames.add(item.publisher.toLowerCase());
      }
    }
  }
  const healthyNewsCount = newsChecks.filter(({ status, dataValid }) =>
    status === 'HEALTHY' && dataValid === true
  ).length;
  if (healthyNewsCount < 2 || publisherNames.size < 2) {
    assert.equal(
      newsVote.vote,
      'ABSTAIN',
      `${asset} member 8 must abstain without two healthy feeds and two actual publishers.`,
    );
  } else {
    assert.notEqual(
      newsVote.vote,
      'ABSTAIN',
      `${asset} member 8 should vote with two healthy feeds and two actual publishers.`,
    );
  }
  console.log(
    `${asset} | member 8 | ${healthyNewsCount}/4 healthy feeds | ${publisherNames.size} publishers | ${newsVote.vote} | source=${newsVote.sourceId ?? 'none'} | fallback=${newsVote.fallbackSourceId ?? 'none'}`,
  );
  for (const check of newsChecks) {
    console.log(`  ${check.sourceId} | ${check.status} | ${check.dataDetail ?? check.detail}`);
  }
}

console.log(`[LIVE API VERIFICATION] completedAt=${new Date().toISOString()} elapsedMs=${Date.now() - liveVerificationStartedAtMs}`);
console.log('Live asset-specific council source checks passed for members 1-8.');
