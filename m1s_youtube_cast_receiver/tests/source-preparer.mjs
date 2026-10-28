import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {PreparedSourceCache} from '../prepared-source-cache.mjs';
import {SourcePreparer} from '../source-preparer.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'm1s-preparer-tests-'));
const A = 'AAAAAAAAAAA', B = 'BBBBBBBBBBB';
const spawned = [], logs = [];
let now = 1000;
const cache = new PreparedSourceCache({tmpDir: directory, now: () => now, ttlMs: 1000});
const fakeSpawn = (_executable, args, options) => {
  const child = Object.assign(new EventEmitter(), {stderr: new PassThrough(), kills: []});
  child.kill = signal => {child.kills.push(signal); setImmediate(() => child.emit('close', null, signal));};
  spawned.push({child, args, options});
  return child;
};
const preparer = new SourcePreparer({cache, spawn: fakeSpawn, now: () => now,
  log: (level, line) => logs.push({level, line}), label: '[Test]', retryMs: 100});
const capturePath = args => args[args.indexOf('--print-to-file') + 2];
const complete = (call, id) => {
  fs.writeFileSync(capturePath(call.args), JSON.stringify({id, title: 'Prepared song',
    url: 'https://media.example/audio.webm?secret=signed', ext: 'webm', format_id: '251',
    http_headers: {'User-Agent': 'Original source'}}));
  call.child.emit('close', 0);
};
try {
  const first = preparer.prepare(A);
  assert.equal(preparer.prepare(A), first, 'same pending video shares one extraction');
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].args.includes('--skip-download'), 'background extraction never invokes the audio downloader');
  assert.equal(spawned[0].args[spawned[0].args.indexOf('-f') + 1], 'bestaudio[ext=webm]/bestaudio');
  assert.deepEqual(spawned[0].options.stdio, ['ignore', 'ignore', 'pipe']);
  assert.ok(fs.statSync(capturePath(spawned[0].args)).isFile());
  complete(spawned[0], A); assert.equal(await first, true);
  assert.equal(cache.has(A), true); assert.deepEqual(fs.readdirSync(directory), []);
  assert.equal(await preparer.prepare(A), true); assert.equal(spawned.length, 1, 'ready metadata never extracts again');

  // A candidate change cancels and cleans the abandoned attempt, including
  // when that old process reports a success after the new preparation starts.
  const old = preparer.prepare(B), oldCall = spawned.at(-1);
  now += 1001; // A's old cache entry is expired.
  const replacement = preparer.prepare(A), currentCall = spawned.at(-1);
  assert.notEqual(oldCall, currentCall);
  assert.ok(oldCall.child.kills.includes('SIGTERM'));
  assert.ok(!fs.existsSync(capturePath(oldCall.args)));
  oldCall.child.emit('close', 0); assert.equal(await old, false);
  complete(currentCall, A); assert.equal(await replacement, true);
  assert.equal(cache.has(B), false, 'cancelled metadata cannot poison the next candidate');

  // Error/corrupt metadata keeps normal playback's cold extraction available,
  // cleans files and throttles retries only for this background job.
  const failed = preparer.prepare(B), failedCall = spawned.at(-1);
  failedCall.child.stderr.write('secret signed URL must never be logged');
  failedCall.child.emit('close', 1); assert.equal(await failed, false);
  const count = spawned.length;
  assert.equal(await preparer.prepare(B), false); assert.equal(spawned.length, count);
  assert.equal(cache.has(B), false);
  const cold = cache.plan(B); assert.equal(cold.reused, false); cold.cleanup();
  now += 101;
  const retried = preparer.prepare(B), retryCall = spawned.at(-1);
  assert.equal(spawned.length, count + 1);
  complete(retryCall, B); assert.equal(await retried, true);

  cache.clear();
  const cancelled = preparer.prepare(A), cancelledCall = spawned.at(-1);
  preparer.cancel(); assert.equal(await cancelled, false);
  assert.ok(cancelledCall.child.kills.includes('SIGTERM'));
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.equal(cache.has(A), false);
  assert.ok(logs.some(item => item.line.includes('ready=true')));
  assert.ok(logs.some(item => item.line.includes('cold_fallback=true')));
  assert.ok(logs.every(item => !item.line.includes('signed') && !item.line.includes('https://')));

  const errored = new SourcePreparer({cache, spawn: fakeSpawn});
  const spawnError = errored.prepare(A), errorCall = spawned.at(-1);
  errorCall.child.emit('error', new Error('failed to spawn'));
  assert.equal(await spawnError, false);
  assert.deepEqual(fs.readdirSync(directory), []);

  const throwing = new SourcePreparer({cache, spawn: () => {throw new Error('spawn failed');}});
  assert.equal(await throwing.prepare(A), false);
  assert.deepEqual(fs.readdirSync(directory), []);

  const timed = new SourcePreparer({cache, spawn: fakeSpawn, timeoutMs: 10});
  const timedOut = timed.prepare(A), timedCall = spawned.at(-1);
  await delay(25);
  assert.equal(await timedOut, false);
  assert.ok(timedCall.child.kills.includes('SIGTERM'));
  assert.equal(cache.has(A), false);
  assert.deepEqual(fs.readdirSync(directory), []);

  const stubbornSpawn = (...args) => {
    const child = fakeSpawn(...args);
    child.kill = signal => {child.kills.push(signal);};
    return child;
  };
  const stubborn = new SourcePreparer({cache, spawn: stubbornSpawn, timeoutMs: 5, killGraceMs: 5});
  const killed = stubborn.prepare(A), stubbornCall = spawned.at(-1);
  await delay(25);
  assert.equal(await killed, false);
  assert.deepEqual(stubbornCall.child.kills, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.equal(await preparer.prepare('invalid'), false);
  console.log('PASS: metadata-only same-format preparation, cache hit/deduplication/expiry, candidate cancellation, cooldown/cold fallback, spawn errors, timeout/kill cleanup and URL-safe logs.');
} finally {
  preparer.cancel();
  assert.deepEqual(fs.readdirSync(directory), []);
  fs.rmdirSync(directory);
}
