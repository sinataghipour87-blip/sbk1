import { pollPublicWhaleObservations } from '../src/services/publicWhaleObservationPoller';

const result = await pollPublicWhaleObservations();
console.log(JSON.stringify({
  status: Object.keys(result.unavailableAssets).length === 0 ? 'COMPLETE' : 'PARTIAL',
  path: result.path,
  observedByAsset: result.observedByAsset,
  rejectedByAsset: result.rejectedByAsset,
  unavailableAssets: result.unavailableAssets,
  note: 'Raw transfer observations are not exchange-attributed Member 6 candidates.',
}, null, 2));
if (Object.keys(result.unavailableAssets).length > 0) process.exitCode = 1;
