import assert from 'node:assert/strict';
import fs from 'node:fs';
import Player from '../node_modules/yt-cast-receiver/dist/lib/Player.js';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';

// Run the production subclass against the pinned Player. Only external title,
// HA and PCM readiness events are controlled; state publication stays real.
const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('class M1SPlayer extends Player {'), source.indexOf('\nasync function initializeVolume'));
const S = Constants.PLAYER_STATUSES;
const A = 'AAAAAAAAAAA', B = 'BBBBBBBBBBB';
const logger = {debug() {}, info() {}, warn() {}, error() {}};
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const until = async condition => {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(condition(), 'production operation must reach the controlled event');
};

function harness({sleep = async () => {}, haService = async () => {}} = {}) {
  const titles = new Map(), logs = [], haCalls = [], sessions = [];
  let serial = 0;
  class Session {
    constructor(player, number) {
      this.player = player; this.serial = number; this.active = true;
      this.url = `http://lan/stream/test/${number}.wav`;
      this.transportLeadMs = 0; this.currentTrackGeneration = 0; this.stops = 0;
      sessions.push(this);
    }
    expectedPath() {return `/stream/test/${this.serial}.wav`;}
    async queueTrack() {return ++this.currentTrackGeneration;}
    async waitTrackOutputStart() {return Date.now();}
    setTransportLeadMs(value) {this.transportLeadMs = value;}
    async stop() {this.stops++; this.active = false;}
  }
  const Type = new Function('Player', 'Constants', 'log', 'sleep', 'safeVideoId',
    'getQuickYouTubeTitle', 'getMetadata', 'ContinuousAudioSession', 'nextStreamSerial', 'haService',
    `${code}\nreturn M1SPlayer;`)(Player, Constants, (...args) => logs.push(args.join(' ')), sleep,
    id => /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null,
    id => {const gate = deferred(); titles.set(id, gate); return gate.promise;},
    async () => ({}), Session, () => ++serial, async (...args) => {haCalls.push(args); return haService(...args);});
  const p = new Type({name: 'Selection test', key: 'test', entityId: 'media_player.test'});
  p.setLogger(logger); p.queue.setLogger(logger);
  p.targetStillOwnedByYoutube = async () => true;
  p.waitForPendingGroupSenderRestore = async () => {};
  p.captureSessionSenderForStart = () => {};
  p.ensureIndividualReadyForPlayback = async () => {};
  p.ensureInitialGroupCleanStart = async () => true;
  p.startOwnershipMonitor = () => {};
  p.startProgressUpdates = () => {};
  p.scheduleHomeAssistantMetadata = () => {};
  p.enrichMetadata = async () => {};
  p.waitUntilTargetStopped = async () => true;
  p.restoreIndividualGroupAfterStop = async () => {};
  const states = [];
  p.on('state', event => states.push({status: event.current.status, id: event.current.queue.current?.id}));
  return {p, titles, logs, haCalls, sessions, Session, states};
}

async function ready(options) {
  const h = harness(options), {p, Session} = h;
  p.currentVideo = {id: 'OLD00000000'}; p.currentVideoId = p.currentVideo.id;
  p.queue.setAsCurrent(p.currentVideo);
  p.continuousSession = new Session(p, 1); p.ownsTarget = true;
  p.musicSenderActive = false; // normal YouTube and mixed YT/YTM senders.
  await p.notifyExternalStateChange(S.PLAYING);
  h.states.length = 0;
  return h;
}

for (const completion of ['old-last', 'old-first', 'old-rejected']) {
  const h = await ready(), {p, titles, states} = h;
  const dispatched = [];
  p.switchTrackInsideSession = async prepared => {dispatched.push(prepared.id); p.startedAt = Date.now(); return true;};
  const old = p.play({id: A}, 0); await until(() => titles.has(A));
  const current = p.play({id: B}, 0); await until(() => titles.has(B));
  if (completion === 'old-first') {
    titles.get(A).resolve('Obsolete title'); assert.equal(await old, false);
    assert.ok(!states.some(state => state.status === S.STOPPED));
  }
  titles.get(B).resolve('Selected title'); assert.equal(await current, true);
  if (completion === 'old-last') titles.get(A).resolve('Obsolete title');
  if (completion === 'old-rejected') titles.get(A).reject(new Error('Old title request failed'));
  assert.equal(await old, false);
  assert.equal(p.status, S.PLAYING);
  assert.equal(p.currentVideoId, B); assert.equal(p.title, 'Selected title');
  assert.deepEqual(dispatched, [B]);
  assert.ok(!states.some(state => state.status === S.STOPPED), 'obsolete metadata cannot publish STOPPED for the current selection');
  assert.equal(p.continuousSession.active, true);
}

// An older selection can also finish title preparation and then wait at the
// group-restoration barrier. It must never dispatch after a newer song starts.
{
  const h = await ready(), {p, states} = h, barrier = deferred(), dispatched = [];
  let waits = 0;
  p.waitForPendingGroupSenderRestore = () => ++waits === 1 ? barrier.promise : Promise.resolve();
  p.switchTrackInsideSession = async prepared => {dispatched.push(prepared.id); return true;};
  const old = p.play({id: A, title: 'Old'}, 0); await until(() => waits === 1);
  assert.equal(await p.play({id: B, title: 'Current'}, 0), true);
  barrier.resolve(); assert.equal(await old, false);
  assert.deepEqual(dispatched, [B]); assert.equal(p.status, S.PLAYING);
  assert.ok(!states.some(state => state.status === S.STOPPED));
}

// Reproduce a late replacement completion AFTER PCM was ready but while its
// established transport lead was being awaited. Its false result used to stop B.
{
  const lead = deferred(); let waitingLead = false;
  const h = await ready({sleep: () => {waitingLead = true; return lead.promise;}});
  const {p, states} = h, session = p.continuousSession;
  session.transportLeadMs = 1000;
  const old = p.play({id: A, title: 'Old'}, 0); await until(() => waitingLead);
  session.transportLeadMs = 0;
  assert.equal(await p.play({id: B, title: 'Current'}, 0), true);
  const currentClock = p.startedAt;
  lead.resolve(); assert.equal(await old, false);
  assert.equal(p.startedAt, currentClock); assert.equal(p.status, S.PLAYING);
  assert.ok(!states.some(state => state.status === S.STOPPED));
  assert.equal(session.stops, 0);
}

// The first HA start may still be waiting for transport confirmation when a
// newer selection reuses that same transport. The old start cannot stop it.
{
  const h = harness(), {p, states} = h, transport = deferred();
  let waitingTransport = false;
  p.waitForTransportStarted = () => {waitingTransport = true; return transport.promise;};
  const old = p.play({id: A, title: 'Initial'}, 0); await until(() => waitingTransport);
  const session = p.continuousSession;
  assert.equal(await p.play({id: B, title: 'Current'}, 0), true);
  const currentClock = p.startedAt;
  transport.resolve({exact: true, at: Date.now()}); assert.equal(await old, false);
  assert.equal(p.status, S.PLAYING); assert.equal(p.startedAt, currentClock);
  assert.equal(session.active, true); assert.equal(session.stops, 0);
  assert.ok(!states.some(state => state.status === S.STOPPED));
}

// Actual explicit Stop invalidates a normal YT title request, closes its
// transport and remains STOPPED when the outstanding lookup eventually returns.
{
  const h = await ready(), {p, titles, states} = h, session = p.continuousSession;
  const old = p.play({id: A}, 0); await until(() => titles.has(A));
  assert.equal(await p.stop(), true);
  titles.get(A).resolve('Late title after Stop'); assert.equal(await old, false);
  assert.equal(p.status, S.STOPPED); assert.equal(session.active, false);
  assert.equal(p.continuousSession, null);
  const stopped = states.findIndex(state => state.status === S.STOPPED);
  assert.ok(stopped >= 0);
  assert.ok(!states.slice(stopped + 1).some(state => state.status === S.PLAYING));
}

// A late response from an abandoned initial HA start closes only its old
// local session. It cannot close B or publish an obsolete failure for B.
{
  const haReply = deferred(); let starts = 0;
  const h = harness({haService: async (_entity, action) => {
    if (action === 'play_media' && ++starts === 1) await haReply.promise;
  }});
  const {p, sessions, states} = h;
  p.waitForTransportStarted = async () => ({exact: true, at: Date.now()});
  const old = p.play({id: A, title: 'Initial A'}, 0); await until(() => starts === 1);
  assert.equal(await p.play({id: B, title: 'Initial B'}, 0), true);
  assert.equal(sessions.length, 2);
  haReply.resolve(); assert.equal(await old, false);
  assert.equal(sessions[0].stops, 1);
  assert.equal(sessions[1].active, true); assert.equal(sessions[1].stops, 0);
  assert.equal(p.continuousSession, sessions[1]); assert.equal(p.status, S.PLAYING);
  assert.ok(!states.some(state => state.status === S.STOPPED));
}

// A real current validation failure still follows base Player's failure path.
{
  const {p, states} = await ready();
  assert.equal(await p.play({id: 'invalid'}, 0), false);
  assert.equal(p.status, S.STOPPED);
  assert.equal(states.at(-1).status, S.STOPPED);
}

// A current HA start failure must remain a real failure, rather than being
// mislabeled as cancellation by the lifecycle assertions.
{
  const h = harness({haService: async () => {throw new Error('HA start failed');}});
  const {p, states, sessions} = h;
  assert.equal(await p.play({id: A, title: 'Current'}, 0), false);
  assert.equal(p.status, S.STOPPED); assert.equal(states.at(-1).status, S.STOPPED);
  assert.equal(sessions[0].stops, 1); assert.equal(p.continuousSession, null);
}

console.log('PASS: real pinned Player manual selection survives obsolete title/barrier/start/switch completions; current failure and explicit Stop retain their state behavior; existing transport remains active.');
