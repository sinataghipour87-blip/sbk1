import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  quorumSnapshotMaxAgeMs,
  quorumSnapshotStaleReason,
  startQuorumSnapshotWatchdog,
} from '../src/services/quorumSnapshotWatchdog';

function startWatchdogProcess(filePath: string, startedAtMs: number): {
  child: ChildProcess;
  started: Promise<void>;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
} {
  const moduleUrl = pathToFileURL(path.resolve('src/services/quorumSnapshotWatchdog.ts')).href;
  const program = [
    `import { startQuorumSnapshotWatchdog } from ${JSON.stringify(moduleUrl)};`,
    `startQuorumSnapshotWatchdog({ filePath: process.env.TEST_SNAPSHOT_PATH, startedAtMs: Number(process.env.TEST_STARTED_AT), checkIntervalMs: 5, onStale: () => { console.log('watchdog_restart_requested'); process.exit(1); } });`,
    `console.log('watchdog_started');`,
    `setInterval(() => {}, 1000);`,
  ].join('\n');
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', program],
    {
      env: {
        ...process.env,
        TEST_SNAPSHOT_PATH: filePath,
        TEST_STARTED_AT: String(startedAtMs),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let capturedOutput = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    capturedOutput += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    capturedOutput += chunk;
  });
  const started = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.stdout.on('data', (chunk: string) => {
      if (String(chunk).includes('watchdog_started')) resolve();
    });
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, started, closed, output: () => capturedOutput };
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'sbk1-snapshot-watchdog-'));
try {
  const filePath = path.join(directory, 'quorum-candidates.json');
  const nowMs = Date.now();
  await writeFile(filePath, '{}', 'utf8');
  await utimes(filePath, new Date(nowMs - 11 * 60_000), new Date(nowMs - 11 * 60_000));
  assert.match(
    await quorumSnapshotStaleReason({ filePath, nowMs, maxAgeMs: 10 * 60_000 }) ?? '',
    /exceeds 10 minute limit/,
  );
  assert.equal(
    await quorumSnapshotStaleReason({ filePath, nowMs, maxAgeMs: 12 * 60_000 }),
    null,
  );
  assert.equal(quorumSnapshotMaxAgeMs({}), 10 * 60_000);
  assert.throws(
    () => quorumSnapshotMaxAgeMs({ SBK1_QUORUM_SNAPSHOT_MAX_AGE_MINUTES: '0' }),
    /must be an integer/,
  );

  let restartReason: string | null = null;
  const stop = startQuorumSnapshotWatchdog({
    filePath,
    now: () => nowMs,
    startedAtMs: nowMs - 11 * 60_000,
    checkIntervalMs: 5,
    onStale: (reason) => {
      restartReason = reason;
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(restartReason ?? '', /exceeds 10 minute limit/);
  } finally {
    stop();
  }

  const staleRunner = startWatchdogProcess(filePath, nowMs - 11 * 60_000);
  const staleExit = await staleRunner.closed;
  assert.equal(staleExit.code, 1, 'a stale runner exits unsuccessfully so its supervisor restarts it');
  assert.match(staleRunner.output(), /watchdog_restart_requested/);

  const restartedRunner = startWatchdogProcess(filePath, Date.now());
  await restartedRunner.started;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(restartedRunner.child.exitCode, null, 'the restarted runner gets time to refresh the old snapshot');
  restartedRunner.child.kill('SIGTERM');
  const restartedExit = await restartedRunner.closed;
  assert.equal(restartedExit.signal, 'SIGTERM');

  const freshPath = path.join(directory, 'fresh-quorum-candidates.json');
  await writeFile(freshPath, '{}', 'utf8');
  const freshRunner = startWatchdogProcess(freshPath, Date.now());
  await freshRunner.started;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(freshRunner.child.exitCode, null, 'a fresh snapshot does not request a runner restart');
  assert.doesNotMatch(freshRunner.output(), /watchdog_restart_requested/);
  freshRunner.child.kill('SIGTERM');
  await freshRunner.closed;

  const missingPath = path.join(directory, 'missing.json');
  assert.equal(
    await quorumSnapshotStaleReason({
      filePath: missingPath,
      nowMs,
      startedAtMs: nowMs - 5 * 60_000,
      maxAgeMs: 10 * 60_000,
    }),
    null,
    'a missing snapshot gets a startup grace period while the first poll runs',
  );
  assert.equal(
    await quorumSnapshotStaleReason({
      filePath,
      nowMs,
      startedAtMs: nowMs - 5 * 60_000,
      maxAgeMs: 10 * 60_000,
    }),
    null,
    'a previously stale snapshot gets one startup window for the first poll to refresh it',
  );
  assert.match(
    await quorumSnapshotStaleReason({
      filePath: missingPath,
      nowMs,
      startedAtMs: nowMs - 11 * 60_000,
      maxAgeMs: 10 * 60_000,
    }) ?? '',
    /snapshot is missing/,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Quorum snapshot watchdog stale-restart checks passed.');
