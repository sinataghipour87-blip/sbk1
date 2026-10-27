import assert from 'node:assert/strict';
import { checkCouncilMemberSources } from '../src/services/councilSourceHealth';
import { evaluateEightMemberCouncil } from '../src/services/eightMemberCouncil';
import { getCouncilMemberSources } from '../src/services/councilSourceRegistry';
import { fetchOnChainWhaleData } from '../src/services/publicBitcoinWhaleData';

const assets = ['BTC', 'SOL', 'XRP', 'BNB'] as const;
const minimumHealthySources: Readonly<Record<number, number>> = {
  1: 2,
  2: 1,
  3: 2,
  4: 2,
};

for (const asset of assets) {
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
    assert.equal(sources.length, 4, `${asset} member ${memberId} has four source entries`);
    assert.equal(checks.length, 4, `${asset} member ${memberId} checked all four entries`);
    const healthyCount = checks.filter(({ status, dataValid }) =>
      status === 'HEALTHY' && dataValid === true
    ).length;
    const minimum = minimumHealthySources[memberId];
    const vote = report.members.find((member) => member.id === memberId);
    assert.ok(vote, `${asset} member ${memberId} vote is present`);
    assert.ok(
      healthyCount >= minimum,
      `${asset} member ${memberId} has ${healthyCount}/4 healthy sources; needs ${minimum}.`,
    );
    assert.notEqual(
      vote.vote,
      'ABSTAIN',
      `${asset} member ${memberId} must vote with its verified live sources.`,
    );
    console.log(
      `${asset} | member ${memberId} | ${healthyCount}/4 healthy | ${vote.vote} | source=${vote.sourceId ?? 'none'} | fallback=${vote.fallbackSourceId ?? 'none'}`,
    );
    for (const check of checks) {
      console.log(
        `  ${check.sourceId} | ${check.status} | HTTP=${check.httpHealthy} | data=${check.dataValid} | ${check.dataDetail ?? check.detail}`,
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
  const directionalCount = optionChecks.filter(({ status, dataValid, voteValue }) =>
    status === 'HEALTHY' && dataValid === true && voteValue === 'USEFUL'
  ).length;
  const optionsVote = report.members.find((member) => member.id === 5);
  assert.ok(optionsVote, `${asset} member 5 vote is present`);
  if (directionalCount < 2) {
    assert.equal(
      optionsVote.vote,
      'ABSTAIN',
      `${asset} member 5 must abstain with fewer than two directional option sources.`,
    );
  } else {
    assert.notEqual(
      optionsVote.vote,
      'ABSTAIN',
      `${asset} member 5 should vote with two directional option sources.`,
    );
  }
  console.log(
    `${asset} | member 5 | ${optionChecks.filter(({ status, dataValid }) => status === 'HEALTHY' && dataValid === true).length}/${optionSources.length} healthy | ${directionalCount} directional | ${optionsVote.vote} | source=${optionsVote.sourceId ?? 'none'} | fallback=${optionsVote.fallbackSourceId ?? 'none'}`,
  );
  for (const check of optionChecks) {
    console.log(
      `  ${check.sourceId} | ${check.status} | HTTP=${check.httpHealthy} | data=${check.dataValid} | voteValue=${check.voteValue} | ${check.dataDetail ?? check.detail}`,
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

console.log('Live asset-specific council source checks passed for members 1-8.');
