import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  emptyMember6BlockCursorStore,
  getMember6BlockRange,
  loadMember6BlockCursorStore,
  parseMember6BlockCursorStore,
  writeMember6BlockCursorStore,
} from '../src/services/member6BlockCursor';

assert.deepEqual(getMember6BlockRange(100, undefined, 12), {
  fromBlock: 89,
  throughBlock: 100,
  nextBlock: 101,
}, 'first run bootstraps the requested recent window');
assert.deepEqual(getMember6BlockRange(140, 89, 12), {
  fromBlock: 89,
  throughBlock: 100,
  nextBlock: 101,
}, 'a backlog is scanned from the saved cursor without jumping to the head');
assert.deepEqual(getMember6BlockRange(100, 99, 12), {
  fromBlock: 99,
  throughBlock: 100,
  nextBlock: 101,
}, 'the next range begins exactly after the last committed block');
assert.equal(getMember6BlockRange(100, 101, 12), null, 'no new blocks leaves the cursor unchanged');
assert.throws(
  () => getMember6BlockRange(100, 1, 0),
  /range settings are invalid/,
);
assert.throws(
  () => parseMember6BlockCursorStore({
    version: 1,
    nextBlockByAsset: { BTC: 0 },
  }),
  /invalid asset cursor/,
);

const directory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-member6-cursors-'));
const cursorPath = path.join(directory, 'cursors.json');
try {
  const empty = await loadMember6BlockCursorStore(cursorPath);
  assert.deepEqual(empty, emptyMember6BlockCursorStore());
  await writeMember6BlockCursorStore({
    version: 1,
    nextBlockByAsset: { BTC: 101, ETH: 202, BNB: 303, SOL: 404, XRP: 505 },
  }, cursorPath);
  assert.deepEqual(await loadMember6BlockCursorStore(cursorPath), {
    version: 1,
    nextBlockByAsset: { BTC: 101, ETH: 202, BNB: 303, SOL: 404, XRP: 505 },
  });
  await writeFile(cursorPath, '{"version":1,"nextBlockByAsset":{"BTC":"bad"}}', 'utf8');
  await assert.rejects(loadMember6BlockCursorStore(cursorPath), /invalid asset cursor/);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.info('Member 6 per-asset block cursor persistence, bootstrap, and no-skip range checks passed.');
