import assert from 'node:assert/strict';
import fs from 'node:fs';
import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import Playlist from '../node_modules/yt-cast-receiver/dist/lib/app/Playlist.js';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
import RequestHandler from '../node_modules/yt-cast-receiver/dist/lib/app/PlaylistRequestHandler.js';
import { createQueueHandler } from '../queue-handler.mjs';

const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const dependency = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/Player.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default Player;', '');
const Base = new Function('EventEmitter', 'uuidv4', 'AUTOPLAY_MODES', 'PLAYER_STATUSES', 'Playlist', `${dependency}\nreturn Player;`)
  (EventEmitter, randomUUID, Constants.AUTOPLAY_MODES, Constants.PLAYER_STATUSES, Playlist);
const constants = source.slice(source.indexOf('const PCM_RATE ='), source.indexOf('function createStreamingWavHeader()'));
const sessionClass = source.slice(source.indexOf('class ContinuousAudioSession {'), source.indexOf('\nfunction nextStreamSerial()'));
const playerClass = source.slice(source.indexOf('class M1SPlayer extends Player {'), source.indexOf('\nasync function initializeVolume'));
const S = Constants.PLAYER_STATUSES;
const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'];
const logger = { debug() {}, info() {}, warn() {}, error() {} };
function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 150; i++) await Promise.resolve(); }

async function fixture({ count = 3, lead = 2500, autoplay = false } = {}) {
  let now = 100000;
  class Clock extends Date { static now() { return now; } }
  const logs = [], sleeps = [], output = [], states = [], services = [], paces = [];
  const log = (...args) => logs.push(args.join(' '));
  const sleep = ms => { const wait = deferred(); sleeps.push({ ms, at: now, ...wait }); return wait.promise; };
  const Session = new Function('cfg', 'streamHost', 'safeVideoId', 'log', 'Date', `${constants}\n${sessionClass}\nreturn ContinuousAudioSession;`)
    ({ audioPort: 8098 }, '127.0.0.1', value => value, log, Clock);
  const metadata = { displayMetadata: id => ({ title: `Captured ${id[0].toUpperCase()}`, artist: 'Captured artist', duration: 314 }) };
  const M1S = new Function('Player', 'Constants', 'log', 'sleep', 'Date', 'safeVideoId', 'getQuickYouTubeTitle', 'setTimeout', 'haService', 'preparedSources',
    `${playerClass}\nreturn M1SPlayer;`)
    (Base, Constants, log, sleep, Clock, value => value, async () => null, () => ({ unref() {} }),
      async (entity, service) => services.push(service), metadata);
  const p = new M1S({ name: 'Natural handoff test', key: 'natural', entityId: 'media_player.natural' });
  p.setLogger(logger); p.queue.setLogger(logger);
  class HandlerBase extends RequestHandler {
    async getPreviousNextVideos(target) {
      return { previous: null, next: { id: ids[1], client: target.client, context: { index: 1 } } };
    }
  }
  const Handler = createQueueHandler(HandlerBase, Constants.AUTOPLAY_MODES.ENABLED);
  const handler = new Handler(); handler.setLogger(logger); p.queue.setRequestHandler(handler);
  if (autoplay) await p.queue.setAutoplayMode(Constants.AUTOPLAY_MODES.ENABLED);
  await p.queue.updateByMessage({ name: 'setPlaylist', payload: {
    listId: 'natural-test', videoIds: ids.slice(0, count).join(','), videoId: ids[0], currentIndex: '0'
  } }, { key: 'YT' });
  const productionDoPlay = p.doPlay;
  p.doPlay = async video => {
    p.currentVideo = video; p.currentVideoId = video.id;
    p.title = 'Original A'; p.duration = 180; p.basePosition = 175;
    p.startedAt = now; return true;
  };
  await p.play(p.queue.current, 0);
  p.doPlay = productionDoPlay;
  p.ownsTarget = true;
  p.targetStillOwnedByYoutube = async () => true;
  p.waitForPendingGroupSenderRestore = async () => {};
  p.scheduleHomeAssistantMetadata = () => {};
  p.waitUntilTargetStopped = async () => true;
  p.restoreIndividualGroupAfterStop = async () => {};
  const session = new Session(p, 1);
  p.continuousSession = session;
  session.transportLeadMs = lead;
  let manualSource = false;
  session._decodeTrackAttempt = async (id, position, generation) => {
    for (let i = 0; i < 3; i++) {
      if (!(await session._enqueueChunk(generation, Buffer.alloc(4480, id.charCodeAt(0))))) return 'cancelled';
    }
    return manualSource ? 'cancelled' : 'eof';
  };
  session.clientReady.resolve();
  session.response = { destroyed: false, writableEnded: false, end() { this.writableEnded = true; } };
  session._pace = () => { const pace = deferred(); paces.push(pace); return pace.promise; };
  session._writeChunk = async chunk => output.push(String.fromCharCode(chunk[0]));
  p.on('state', event => states.push({ ...event.current, at: now, output: output.join('') }));
  await session.queueTrack(ids[0], 0);
  await flush();
  const task = session._outputLoop();
  await flush();
  async function step() {
    await flush(); assert.ok(paces.length, 'output loop must reach a PCM pacing boundary');
    now += 35; paces.shift().resolve(); await flush();
  }
  async function releaseSleep() {
    await flush(); assert.ok(sleeps.length, 'expected existing transport/drain wait');
    const wait = sleeps.shift(); now = Math.max(now, wait.at + wait.ms); wait.resolve(); await flush();
    return wait.ms;
  }
  async function close() {
    p.invalidateNaturalHandoff(); await session.stop();
    for (const pace of paces.splice(0)) pace.resolve();
    for (const wait of sleeps.splice(0)) wait.resolve();
    await flush(); await task;
  }
  return { p, session, output, states, services, logs, sleeps, step, releaseSleep, close,
    manual() { manualSource = true; }, metadata, setNow(value) { now = value; } };
}

// Full production lifecycle: old tail stays current; the successor is decoded
// early, but queue/state/clock change only after its real output + existing lead.
const f = await fixture();
assert.equal(f.session.currentTrackGeneration, 2);
assert.equal(f.p.queue.current.id, ids[0]);
assert.equal(f.p.currentVideoId, ids[0]);
assert.equal(f.p.title, 'Original A');
assert.equal(f.p.basePosition, 175);
assert.deepEqual(f.states, []);
assert.ok(Object.isFrozen(f.p.naturalAdvanceBoundary));
for (let i = 0; i < 3; i++) {
  await f.step();
  assert.equal(f.p.queue.current.id, ids[0]);
  assert.equal(f.p.currentVideoId, ids[0]);
}
assert.equal(f.output.join(''), 'aaa');
await f.step(); // First B PCM is written into the unchanged transport.
assert.equal(f.output.join(''), 'aaab');
assert.equal(f.p.queue.current.id, ids[0]);
assert.deepEqual(f.states, []);
assert.equal(f.sleeps[0].ms, 2500);
await f.releaseSleep();
assert.equal(f.p.queue.current.id, ids[1]);
assert.equal(f.p.currentVideoId, ids[1]);
assert.equal(f.p.title, 'Captured B');
assert.equal(f.p.duration, 314);
assert.equal(f.p.artist, 'Captured artist');
assert.equal(f.p.basePosition, 0);
assert.ok(f.states.length >= 1);
assert.ok(f.states.every(state => state.status === S.PLAYING && state.queue.current.id === ids[1]));
assert.equal(f.states[0].at, f.p.startedAt);
assert.deepEqual(f.services, []);
// B already reached source EOF while A remained current. Its deferred EOF must
// now stage C instead of disappearing behind the previous boundary guard.
assert.equal(f.session.currentTrackGeneration, 3);
for (let i = 0; i < 3; i++) await f.step();
assert.equal(f.output.join(''), 'aaabbbc');
assert.equal(f.p.currentVideoId, ids[1]);
await f.releaseSleep();
assert.equal(f.p.currentVideoId, ids[2]);
assert.ok(f.states.every(state => ![S.LOADING, S.STOPPED].includes(state.status)));
await f.close();

// Manual commands invalidate staging. The old natural callback may settle
// afterward, but cannot advance the playlist, stop a newer request or clear a
// newer token. Production queue/wait cancellation is exercised here as well.
for (const operation of ['pause', 'stop', 'seek', 'play']) {
  const f = await fixture();
  f.manual();
  let command;
  if (operation === 'pause') command = f.p.pause();
  if (operation === 'stop') command = f.p.stop();
  if (operation === 'seek') command = f.p.seek(40);
  if (operation === 'play') command = f.p.play({ id: ids[3], title: 'Manual D', duration: 200 }, 0);
  await flush();
  assert.equal(f.p.naturalAdvanceBoundary, null);
  assert.equal(f.p.currentVideoId, operation === 'play' ? ids[3] : ids[0]);
  assert.ok(!f.states.some(state => state.queue.current?.id === ids[1]));
  assert.equal(f.services.filter(service => service === 'media_stop').length, operation === 'stop' ? 1 : 0);
  // Settle pending deliberate seek/play without allowing another source EOF.
  if (operation === 'seek' || operation === 'play') {
    const start = f.session.trackOutputStarts.get(f.session.currentTrackGeneration);
    start.started = true; start.resolve(0);
  }
  await command;
  await f.close();
}

// A manual seek expresses intent before its slow HA ownership response. The
// pending natural handoff must not change A to B while that response is pending.
const slowSeek = await fixture();
slowSeek.manual();
const manualOwnership = deferred();
slowSeek.p.targetStillOwnedByYoutube = () => manualOwnership.promise;
const requestedSources = [];
const originalDecode = slowSeek.session._decodeTrackAttempt;
slowSeek.session._decodeTrackAttempt = (id, position, generation) => {
  requestedSources.push({id,position});
  return originalDecode(id, position, generation);
};
const slowCommand = slowSeek.p.seek(40);
assert.ok(slowSeek.p.naturalAdvanceBoundary===null,'cancel natural handoff before awaiting HA');
for(let i=0;i<4;i++) await slowSeek.step();
assert.equal(slowSeek.p.currentVideoId,ids[0]);
assert.equal(slowSeek.p.queue.current.id,ids[0]);
manualOwnership.resolve(true);
await flush();
assert.deepEqual(requestedSources,[{id:ids[0],position:40}]);
const manualStart = slowSeek.session.trackOutputStarts.get(slowSeek.session.currentTrackGeneration);
manualStart.started=true;manualStart.resolve(0);
await slowCommand;
assert.ok(!slowSeek.states.some(state=>state.queue.current?.id===ids[1]));
await slowSeek.close();

// A slow stale ownership result must not stage audio or clear a new token.
const ownership = await fixture();
await ownership.close();
const p = ownership.p;
const oldSession = ownership.session;
oldSession.active = true; oldSession.paused = false; oldSession.currentTrackGeneration = 9;
p.continuousSession = oldSession; p.currentVideoId = ids[0]; p.paused = false;
const check = deferred(); p.targetStillOwnedByYoutube = () => check.promise;
const stale = p.handleContinuousSourceEof(ids[0], 9);
await flush();
p.playGeneration += 1;
const newerToken = Object.freeze({ newer: true }); p.naturalAdvanceBoundary = newerToken;
check.resolve(true); await stale;
assert.equal(oldSession.currentTrackGeneration, 9);
assert.equal(p.naturalAdvanceBoundary, newerToken);
p.invalidateNaturalHandoff(); oldSession.active = false;

// Autoplay uses the same late handoff, but library queue context must remain
// mutable so a subsequent sender updatePlaylist cannot throw on frozen fields.
const auto = await fixture({ count: 1, autoplay: true });
for (let i = 0; i < 4; i++) await auto.step();
await auto.releaseSleep();
assert.equal(auto.p.queue.current.id, ids[1]);
assert.equal(Object.isFrozen(auto.p.queue.current.context), false);
await auto.p.queue.updateByMessage({ name: 'updatePlaylist', payload: {
  listId: 'autoplay-updated', videoIds: ids.join(','), params: 'updated'
} }, { key: 'YT' });
assert.equal(auto.p.queue.current.context.playlistId, 'autoplay-updated');
assert.equal(auto.p.queue.current.context.params, 'updated');
await auto.close();

// A playlist-only edit may replace the advertised successor while B is already
// staged. Commit B's actual audio identity, without falsely announcing C or
// assigning a fabricated index for a video removed from the sender's list.
const edited = await fixture();
await edited.p.queue.updateByMessage({ name: 'updatePlaylist', payload: {
  listId: 'edited-during-tail', videoIds: [ids[0], ids[2], ids[3]].join(',')
} }, { key: 'YT' });
assert.equal(edited.p.queue.current.id, ids[0]);
assert.equal(edited.p.queue.getState().next.id, ids[2]);
for (let i = 0; i < 4; i++) await edited.step();
assert.equal(edited.output.join(''), 'aaab');
await edited.releaseSleep();
assert.equal(edited.p.queue.current.id, ids[1]);
assert.equal(edited.p.currentVideoId, ids[1]);
assert.equal(edited.p.queue.current.context.index, undefined);
assert.equal(edited.p.queue.current.context.playlistId, 'edited-during-tail');
assert.ok(edited.states.every(state => state.queue.current.id !== ids[2]));
assert.deepEqual(edited.services, []);
await edited.close();

// A real staged-source timeout is logged and the final predecessor tail drains
// before this still-owned session closes. It must not remain falsely PLAYING.
const failed = await fixture();
await failed.close();
const failurePlayer = failed.p;
const failureSession = failed.session;
failureSession.active = true; failureSession.paused = false;
failureSession.currentTrackGeneration = 20; failureSession.trackGeneration = 20;
failurePlayer.continuousSession = failureSession; failurePlayer.currentVideoId = ids[0]; failurePlayer.paused = false;
failurePlayer.targetStillOwnedByYoutube = async () => true;
failureSession._decodeTrackAttempt = async () => 'cancelled';
const realWait = failureSession.waitTrackOutputStart.bind(failureSession);
failureSession.waitTrackOutputStart = generation => realWait(generation, 5);
let drain;
failureSession.waitTrackOutputDrain = () => { drain = deferred(); return drain.promise; };
const failing = failurePlayer.handleContinuousSourceEof(ids[0], 20);
await new Promise(resolve => setTimeout(resolve, 15)); await flush();
assert.ok(failed.logs.some(line => line.includes('continuous track PCM start timeout')));
assert.ok(drain);
assert.equal(failed.services.filter(service => service === 'media_stop').length, 0);
drain.resolve(0); await failing;
assert.equal(failed.services.filter(service => service === 'media_stop').length, 1);
assert.equal(failurePlayer.status, S.STOPPED);

console.log('PASS: real Player/playlist/session FIFO preserves tail and delays Cast handoff until PCM plus existing lead; short successors advance; manual/stale commands invalidate; autoplay stays mutable; genuine source failure drains and stops safely.');
