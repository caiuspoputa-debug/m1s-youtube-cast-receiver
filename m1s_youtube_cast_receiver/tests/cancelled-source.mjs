import assert from 'node:assert/strict';
import fs from 'node:fs';
import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import Playlist from '../node_modules/yt-cast-receiver/dist/lib/app/Playlist.js';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';

// Evaluate the production classes without starting HTTP servers or HA calls.
const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const constants = source.slice(source.indexOf('const PCM_RATE ='), source.indexOf('function createStreamingWavHeader()'));
const sessionClass = source.slice(source.indexOf('class ContinuousAudioSession {'), source.indexOf('\nfunction nextStreamSerial()'));
const logs = [];
const log = (...args) => logs.push(args.join(' '));
const Session = new Function('cfg', 'streamHost', 'safeVideoId', 'log', `${constants}\n${sessionClass}\nreturn ContinuousAudioSession;`)
  ({ audioPort: 8098 }, '127.0.0.1', value => value, log);
const definition = { name: 'Cancellation test', key: 'test', entityId: 'media_player.test' };
function makeSession(player = { definition }) {
  const session = new Session(player, 1);
  // There is deliberately no decoder output. Cancellation and actual timeout
  // behavior must come from the production queue/wait methods, not a mock wait.
  session._decodeTrack = async () => {};
  return session;
}
const cancellation = error => error?.code === 'M1S_SOURCE_CANCELLED';
const unhandled = [];
const onUnhandled = error => unhandled.push(error);
process.on('unhandledRejection', onUnhandled);
try {
  const session = makeSession();
  const old = await session.queueTrack('old', 0);
  const oldWait = assert.rejects(session.waitTrackOutputStart(old, 100), cancellation);
  const current = await session.queueTrack('new', 148);
  await oldWait;

  // Exercise the actual output loop to prove replacement PCM still starts.
  session.queue.push({ generation: current, chunk: Buffer.alloc(4480) });
  session.clientReady.resolve();
  session.response = { destroyed: false, writableEnded: false };
  session._pace = async () => {};
  session._writeChunk = async () => { session.active = false; };
  await session._outputLoop();
  const outputAt = await session.waitTrackOutputStart(current, 100);
  assert.ok(Number.isFinite(outputAt));
  assert.equal(session.trackOutputStarts.get(current).started, true);
  assert.equal(session.trackOutputStarts.get(old).cancelled, true);

  // Cancellation before a caller attaches its waiter must also be safe.
  const unwatched = makeSession();
  const first = await unwatched.queueTrack('first', 0);
  await unwatched.queueTrack('replacement', 30);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(unwatched.waitTrackOutputStart(first, 100), cancellation);
  await unwatched.stop();

  for (const operation of ['pause', 'stop']) {
    const target = makeSession();
    const generation = await target.queueTrack(operation, 0);
    const cancelled = assert.rejects(target.waitTrackOutputStart(generation, 100), cancellation);
    await target[operation]();
    await cancelled;
    assert.equal(target.trackOutputStarts.get(generation).cancelled, true);
    await target.stop();
  }

  // Natural append keeps queued predecessor audio valid; it is not replacement.
  const append = makeSession();
  const predecessor = await append.queueTrack('previous', 0);
  await append.queueTrack('successor', 0, { append: true });
  assert.equal(append.trackOutputStarts.get(predecessor).cancelled, undefined);
  const started = append.trackOutputStarts.get(predecessor);
  started.started = true;
  started.resolve(123);
  assert.equal(await append.waitTrackOutputStart(predecessor, 100), 123);
  await append.stop();

  // Missing PCM for the CURRENT source remains a genuine error, with the same
  // timeout text. Only intentional cancellation receives the typed result.
  const silent = makeSession();
  const generation = await silent.queueTrack('no-output', 0);
  await assert.rejects(silent.waitTrackOutputStart(generation, 10), error =>
    error.message === 'continuous track PCM start timeout' && !cancellation(error));
  await silent.stop();

  const dependency = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/Player.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default Player;', '');
  const Base = new Function('EventEmitter', 'uuidv4', 'AUTOPLAY_MODES', 'PLAYER_STATUSES', 'Playlist', `${dependency}\nreturn Player;`)
    (EventEmitter, randomUUID, Constants.AUTOPLAY_MODES, Constants.PLAYER_STATUSES, Playlist);
  const playerClass = source.slice(source.indexOf('class M1SPlayer extends Player {'), source.indexOf('\nasync function initializeVolume'));
  let latestSession;
  class StartSession extends Session {
    constructor(...args) { super(...args); latestSession = this; }
    async _decodeTrack() {}
  }
  const M1S = new Function('Player', 'Constants', 'log', 'sleep', 'ContinuousAudioSession', 'nextStreamSerial', 'haService',
    `${playerClass}\nreturn M1SPlayer;`)
    (Base, Constants, log, async () => {}, StartSession, () => 1, async () => {});
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  function player() {
    const value = new M1S(definition);
    value.setLogger(logger);
    value.queue.setLogger(logger);
    value.targetStillOwnedByYoutube = async () => true;
    value.scheduleHomeAssistantMetadata = () => {};
    return value;
  }
  async function queued(target, expected) {
    for (let i = 0; i < 100 && (target()?.currentTrackGeneration || 0) < expected; i++) await Promise.resolve();
    assert.equal(target()?.currentTrackGeneration, expected, 'production caller must queue its source');
  }
  async function readyPlayer() {
    const p = player();
    p.doPlay = async video => {
      p.currentVideo = video; p.currentVideoId = video.id;
      p.startedAt = Date.now(); p.duration = 300;
      return true;
    };
    await p.play({ id: 'current' }, 0);
    p.continuousSession = makeSession(p);
    p.ownsTarget = true;
    return p;
  }

  // Reproduce the real resume + seek burst against the pinned base Player.
  const p = await readyPlayer();
  const active = p.continuousSession;
  await p.pause();
  const states = [];
  p.on('state', event => states.push(event.current.status));
  const resume = p.resume();
  await queued(() => active, 2); // pause invalidates generation 1.
  const seek = p.seek(150);
  await queued(() => active, 3);
  assert.equal(await resume, false, 'superseded resume must finish without waiting 15 seconds');
  const pcm = active.trackOutputStarts.get(3);
  pcm.started = true;
  pcm.resolve(Date.now());
  assert.equal(await seek, true);
  assert.equal(p.basePosition, 150);
  assert.equal(p.status, Constants.PLAYER_STATUSES.PLAYING);
  assert.ok(!states.includes(Constants.PLAYER_STATUSES.STOPPED));
  assert.equal(active.active, true);
  await active.stop();

  // Explicit pause and stop must not publish PLAYING from an obsolete seek.
  for (const operation of ['pause', 'stop']) {
    const p = await readyPlayer();
    const session = p.continuousSession;
    const seek = p.seek(50);
    await queued(() => session, 1);
    if (operation === 'pause') await p.pause();
    else {
      // Same invalidation as doStop, without HA transport/service dependencies.
      p.playGeneration += 1;
      p.continuousSession = null;
      await session.stop();
    }
    assert.equal(await seek, false);
    assert.equal(p.startedAt, null);
    if (operation === 'pause') assert.equal(p.status, Constants.PLAYER_STATUSES.PAUSED);
    await session.stop();
  }

  // A cancelled replacement must bypass base Player.play's false=>STOPPED
  // branch, leaving the still-valid continuous transport open.
  const replacement = await readyPlayer();
  const replacementSession = replacement.continuousSession;
  replacement.playGeneration = 1;
  replacement.doPlay = (video, position) => replacement.switchTrackInsideSession({ id: video.id, position, generation: 1 });
  const replacementStates = [];
  replacement.on('state', event => replacementStates.push(event.current.status));
  const switching = replacement.playSelected({ id: 'replacement' }, 0);
  await queued(() => replacementSession, 1);
  await replacementSession.queueTrack('newer', 60);
  assert.equal(await switching, false);
  assert.deepEqual(replacementStates, [Constants.PLAYER_STATUSES.LOADING]);
  assert.equal(replacementSession.active, true);
  await replacementSession.stop();

  // The initial session start uses its own catch block; cancellation must not
  // fall through to that block's real-failure transport teardown.
  const starting = player();
  starting.captureSessionSenderForStart = () => {};
  starting.waitForPendingGroupSenderRestore = async () => {};
  starting.ensureIndividualReadyForPlayback = async () => {};
  starting.ensureInitialGroupCleanStart = async () => true;
  starting.startOwnershipMonitor = () => {};
  starting.doPlay = (video, position) => starting.startContinuousSession({ id: video.id, position, generation: 0 });
  const startStates = [];
  starting.on('state', event => startStates.push(event.current.status));
  const start = starting.playSelected({ id: 'initial' }, 0);
  await queued(() => latestSession, 1);
  await latestSession.queueTrack('superseding', 90);
  assert.equal(await start, false);
  assert.deepEqual(startStates, [Constants.PLAYER_STATUSES.LOADING]);
  assert.equal(latestSession.active, true);
  assert.ok(!logs.some(line => line.includes('Continuous HA session start failed')));
  await latestSession.stop();

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
  console.log('PASS: production source cancellation clears superseded/pause/stop waits, preserves current PCM and real timeouts, and avoids stale PLAYING/STOPPED or transport teardown.');
} finally {
  process.off('unhandledRejection', onUnhandled);
}
