import assert from 'node:assert/strict';
import fs from 'node:fs';
import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import * as Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
import Player from '../node_modules/yt-cast-receiver/dist/lib/Player.js';
import Message from '../node_modules/yt-cast-receiver/dist/lib/app/Message.js';
import Sender from '../node_modules/yt-cast-receiver/dist/lib/app/Sender.js';
import { AppError, SenderConnectionError, IncompleteAPIDataError } from '../node_modules/yt-cast-receiver/dist/lib/utils/Errors.js';
import { patchWakeState } from '../patch-wake-state.mjs';
import { patchControlTrace } from '../patch-controls.mjs';

const appSource = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js', import.meta.url), 'utf8');
const patched = patchWakeState(appSource, '2.1.0');
assert.equal(patchWakeState(patched, '2.1.0'), patched);
const prefix = '// Another dependency patch marker\n';
assert.equal(patchWakeState(prefix + patched, '2.1.0'), prefix + patched);
assert.equal(patchControlTrace(patched, '2.1.0'), patched, 'control tracing must tolerate the wake marker');
assert.throws(() => patchWakeState(appSource, '2.2.0'), /requires.*2\.1\.0/);
assert.throws(() => patchWakeState('export default class Unknown {}', '2.1.0'), /target mismatch/);

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const sessions = [];
class Session extends EventEmitter {
  constructor(options) { super(); this.client = options.client; this.sent = []; sessions.push(this); }
  async begin() {}
  async end() {}
  async registerPairingCode() {}
  async sendMessage(messages) { this.sent.push(...(Array.isArray(messages) ? messages : [messages])); }
}
class Handler {
  setLogger() {}
  reset() {}
  async getPreviousNextVideosAbortable() { return { previous: null, next: null }; }
}
const dependencies = { EventEmitter, queryString: { parse: value => Object.fromEntries(new URLSearchParams(value)) },
  uuidv4: randomUUID, Message, Session, Sender, AppError, SenderConnectionError, IncompleteAPIDataError,
  ...Constants, DefaultPlaylistRequestHandler: Handler };
delete dependencies.default;
const appCode = patched.replace(/^import .*;\r?\n/gm, '').replace('export default YouTubeApp;', '');
const api = new Function(...Object.keys(dependencies), `${appCode}
return {
  App: YouTubeApp,
  incoming: (app, message, session) => _YouTubeApp_handleIncomingMessage.call(app, message, session),
  connected: (app, sender, session) => _YouTubeApp_handleSenderConnected.call(app, sender, session)
};`)(...Object.values(dependencies));
const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const playerCode = source.slice(source.indexOf('class M1SPlayer extends Player {'), source.indexOf('\nasync function initializeVolume'));
const volumeServices = [];
const M1S = new Function('Player', 'Constants', 'log', 'sleep', 'haService', 'haRequest', `${playerCode}\nreturn M1SPlayer;`)
  (Player, Constants, () => {}, async () => {}, async (...args) => volumeServices.push(args),
    async () => ({ attributes: { is_volume_muted: false } }));
const p = new M1S({ name: 'Wake test', key: 'wake', entityId: 'media_player.wake' });
let plays = 0, stops = 0;
p.doPlay = async (video, position) => {
  plays++; p.playGeneration++; p.currentVideo = video; p.currentVideoId = video.id;
  p.basePosition = position; p.startedAt = Date.now(); p.duration = 120; p.paused = false;
  return true;
};
p.doStop = async () => { stops++; return true; };
p.continuousSession = { active: true };
p.ownsTarget = true;
p.targetStillOwnedByYoutube = async () => true;
const app = new api.App(p, { logger, screenName: 'Wake test', enableAutoplayOnConnect: false,
  playlistRequestHandler: new Handler(), mutePolicy: Constants.MUTE_POLICIES.PRESERVE_VOLUME_LEVEL,
  resetPlayerOnDisconnectPolicy: Constants.RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_EXPLICITLY_DISCONNECTED });
app.on('senderConnect', sender => p.noteSenderConnected(sender));
await app.start(); await app.launch('pairingCode=safe&theme=cl');
const [yt, ytm] = sessions;
const sender = Sender.parse({ id: 'registered-phone', name: 'Phone', theme: 'cl', capabilities: '' });
await p.play({ id: 'AAAAAAAAAAA' }, 0);
await api.connected(app, sender, yt);
await p.play({ id: 'BBBBBBBBBBB' }, 0);
// The phone misses B's first announcement while locked; the hub keeps playing.
yt.sent.length = 0;
p.basePosition = 22; p.startedAt = Date.now();
const audioBefore = { plays, stops, session: p.continuousSession };
await p.publishProgress();
function fullSnapshot(messages, status = Constants.PLAYER_STATUSES.PLAYING) {
  const now = messages.find(message => message instanceof Message.NowPlaying);
  const state = messages.find(message => message instanceof Message.OnStateChange);
  const volume = messages.find(message => message instanceof Message.OnVolumeChanged);
  assert.ok(now && state && volume, 'wake must include current track, cursor/state and volume');
  assert.equal(volume.payload.volume, p.volume.level);
  assert.equal(volume.payload.muted, p.volume.muted);
  assert.equal(now.payload.videoId, 'BBBBBBBBBBB');
  assert.equal(now.payload.state, status);
  assert.equal(state.payload.state, status);
  assert.ok(now.payload.currentTime >= 22 && now.payload.currentTime < 23);
  assert.ok(state.payload.currentTime >= 22 && state.payload.currentTime < 23);
}
fullSnapshot(yt.sent);
fullSnapshot(await api.connected(app, sender, yt));
yt.sent.length = 0;
const devices = JSON.stringify([{ id: sender.id, name: sender.name, type: 'REMOTE_CONTROL', theme: 'cl' }]);
await api.incoming(app, new Message(1, 'loungeStatus', { devices }), yt);
fullSnapshot(yt.sent);
assert.equal(plays, audioBefore.plays); assert.equal(stops, audioBefore.stops);
assert.equal(p.continuousSession, audioBefore.session);

// Normal YT's paused state must also be recoverable after unlock.
p.paused = true; p.startedAt = null;
await p.notifyExternalStateChange(Constants.PLAYER_STATUSES.PAUSED);
yt.sent.length = 0;
await p.publishProgress(); fullSnapshot(yt.sent, Constants.PLAYER_STATUSES.PAUSED);
fullSnapshot(await api.connected(app, sender, yt), Constants.PLAYER_STATUSES.PAUSED);
p.paused = false; p.startedAt = Date.now();
await p.notifyExternalStateChange(Constants.PLAYER_STATUSES.PLAYING);

// Unknown lounge devices and inactive clients cannot acquire control or receive
// a fabricated current playback snapshot through this wake path.
yt.sent.length = 0;
await api.incoming(app, new Message(2, 'loungeStatus', { devices: JSON.stringify([
  { id: 'unknown-phone', name: 'Unknown', type: 'REMOTE_CONTROL', theme: 'cl' }
]) }), yt);
assert.ok(!yt.sent.some(message => message instanceof Message.NowPlaying));
ytm.sent.length = 0;
await api.incoming(app, new Message(3, 'loungeStatus', { devices }), ytm);
assert.ok(!ytm.sent.some(message => message instanceof Message.NowPlaying));

const actualGetState = p.getState.bind(p);
const settle = async predicate => {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate());
};
for (const change of ['generation', 'session', 'ownership', 'relinquished', 'video', 'queue', 'liveQueue', 'pause', 'loading']) {
  const saved = { generation: p.playGeneration, session: p.continuousSession, id: p.currentVideoId,
    owns: p.ownsTarget, relinquished: p.sessionRelinquished, paused: p.paused };
  const snapshot = await actualGetState();
  let resolve, reading = false;
  p.getState = () => { reading = true; return new Promise(value => { resolve = value; }); };
  const wake = api.connected(app, sender, yt);
  await settle(() => reading);
  if (change === 'generation') p.playGeneration++;
  if (change === 'session') p.continuousSession = { active: true };
  if (change === 'ownership') p.ownsTarget = false;
  if (change === 'relinquished') p.sessionRelinquished = true;
  if (change === 'video') p.currentVideoId = 'CCCCCCCCCCC';
  if (change === 'queue') snapshot.queue = { ...snapshot.queue, current: { id: 'CCCCCCCCCCC' } };
  if (change === 'liveQueue') Object.defineProperty(p.queue, 'current', { configurable: true, value: { id: 'CCCCCCCCCCC' } });
  if (change === 'pause' || change === 'loading') {
    Object.defineProperty(p, 'status', { configurable: true, value: change === 'pause'
      ? Constants.PLAYER_STATUSES.PAUSED : Constants.PLAYER_STATUSES.LOADING });
  }
  resolve(snapshot);
  assert.deepEqual(await wake, [], `stale ${change} snapshot must be skipped, never sent empty`);
  if (change === 'liveQueue') delete p.queue.current;
  delete p.status;
  p.playGeneration = saved.generation; p.continuousSession = saved.session; p.currentVideoId = saved.id;
  p.ownsTarget = saved.owns; p.sessionRelinquished = saved.relinquished; p.paused = saved.paused;
  p.getState = actualGetState;
}

// Periodic publication has the same ID/generation guards and releases its
// in-flight flag after skipping a stale read, so the next valid tick can heal.
let finish, reading = false;
const stale = await actualGetState();
p.getState = () => { reading = true; return new Promise(resolve => { finish = resolve; }); };
yt.sent.length = 0;
const publish = p.publishProgress(); await settle(() => reading);
stale.queue = { ...stale.queue, current: { id: 'CCCCCCCCCCC' } };
finish(stale); await publish;
assert.equal(yt.sent.length, 0);
assert.equal(p.progressPublishing, false);
p.getState = actualGetState;
await p.publishProgress(); fullSnapshot(yt.sent);
assert.equal(plays, audioBefore.plays); assert.equal(stops, audioBefore.stops);

// Changing only the live library queue must also suppress a periodic snapshot,
// even before doPlay has changed currentVideoId or playGeneration.
const liveSnapshot = await actualGetState();
p.getState = async () => {
  Object.defineProperty(p.queue, 'current', { configurable: true, value: { id: 'CCCCCCCCCCC' } });
  return liveSnapshot;
};
yt.sent.length = 0; await p.publishProgress();
assert.equal(yt.sent.length, 0);
delete p.queue.current; p.getState = actualGetState;

// Exercise both async handoffs: getState -> wake caller and duplicate handler ->
// outer incoming handler. Real Play/Stop may run in either gap. The last network
// dispatch must drop only stale wake replies, preserving normal control events.
for (const boundary of ['helperCaller', 'outerIncoming']) {
  for (const action of ['selection', 'stop']) {
    const snapshot = await actualGetState();
    let first = true, manual;
    p.getState = () => {
      if (!first) return actualGetState();
      first = false;
      return Promise.resolve(snapshot).then(value => {
        const mutate = () => { manual = action === 'selection' ? p.play({ id: 'CCCCCCCCCCC' }, 0) : p.stop(); };
        queueMicrotask(() => queueMicrotask(() => boundary === 'helperCaller' ? mutate() : queueMicrotask(mutate)));
        return value;
      });
    };
    yt.sent.length = 0;
    if (boundary === 'helperCaller') {
      assert.deepEqual(await api.connected(app, sender, yt), [], `${action} between helper/caller must drop the wake`);
    } else {
      await api.incoming(app, new Message(50, 'loungeStatus', { devices,
        connectionEventDetails: JSON.stringify({ deviceId: sender.id }) }), yt);
      assert.ok(!yt.sent.some(message => message.AID === 50 && message instanceof Message.NowPlaying),
        `${action} between duplicate/outer handler must drop stale network wake`);
    }
    p.getState = actualGetState;
    assert.ok(manual, 'manual control must occur in the scheduled handoff');
    await manual;
    await p.play({ id: 'BBBBBBBBBBB' }, 0);
    p.basePosition = 22; p.startedAt = Date.now();
  }
}

// The wake path restores volume state too; an actual incoming phone volume
// command still traverses App -> adaptive phone volume -> HA volume_set.
yt.sent.length = 0;
await api.incoming(app, new Message(60, 'loungeStatus', { devices }), yt);
fullSnapshot(yt.sent);
const beforeVolume = p.volume.level, audioBeforeVolume = { plays, stops };
await api.incoming(app, new Message(61, 'setVolume', { volume: String(beforeVolume + 1), muted: false }), yt);
assert.equal(volumeServices.length, 1);
assert.equal(volumeServices[0][0], 'media_player.wake');
assert.equal(volumeServices[0][1], 'volume_set');
assert.equal(volumeServices[0][2].volume_level, p.volume.level / 100);
assert.ok(p.volume.level > beforeVolume);
assert.equal(plays, audioBeforeVolume.plays); assert.equal(stops, audioBeforeVolume.stops);

// A known sender waking at an autoplay boundary needs the actual successor ID,
// not just a visible Next button, without waiting for the periodic snapshot.
p.queue.setRequestHandler({
  reset() {},
  async getPreviousNextVideosAbortable(target) {
    return { previous: null, next: { id: 'CCCCCCCCCCC', client: target.client, context: { index: 1 } } };
  }
});
await p.queue.updateByMessage(new Message(62, 'setPlaylist', {
  listId: 'wake-list', videoId: 'BBBBBBBBBBB', videoIds: 'BBBBBBBBBBB', currentIndex: 0
}), yt.client);
await p.queue.setAutoplayMode(Constants.AUTOPLAY_MODES.ENABLED);
const wakeAudioBefore = { plays, stops, session: p.continuousSession };
const nextWake = await api.connected(app, sender, yt);
assert.equal(nextWake.find(message => message instanceof Message.OnHasPreviousNextChanged)?.payload.hasNext, true);
assert.equal(nextWake.find(message => message instanceof Message.AutoplayUpNext)?.payload.videoId, 'CCCCCCCCCCC');
assert.equal(nextWake.find(message => message instanceof Message.OnAutoplayModeChanged)?.payload.autoplayMode,
  Constants.AUTOPLAY_MODES.ENABLED);
assert.deepEqual({ plays, stops, session: p.continuousSession }, wakeAudioBefore);

// getState snapshots the queue before awaiting its position/volume reads. If
// recommendation lookup completes during that wait, the wake must announce the
// newly ready candidate together with the newly ready Next flag.
await p.queue.setAutoplayMode(Constants.AUTOPLAY_MODES.DISABLED);
const beforeNavigationReady = await actualGetState();
assert.equal(beforeNavigationReady.queue.autoplay, null);
let finishWakeRead;
p.getState = () => new Promise(resolve => { finishWakeRead = resolve; });
const waitingForNavigation = api.connected(app, sender, yt);
await settle(() => Boolean(finishWakeRead));
await p.queue.setAutoplayMode(Constants.AUTOPLAY_MODES.ENABLED);
assert.equal(p.queue.autoplay.id, 'CCCCCCCCCCC');
finishWakeRead(beforeNavigationReady);
const navigationReadyWake = await waitingForNavigation;
p.getState = actualGetState;
assert.equal(navigationReadyWake.find(message => message instanceof Message.OnHasPreviousNextChanged)?.payload.hasNext, true);
assert.equal(navigationReadyWake.find(message => message instanceof Message.AutoplayUpNext)?.payload.videoId,
  'CCCCCCCCCCC', 'a ready recommendation must replace the queue captured before the asynchronous state read');

// A queue-only change may also occur after the helper has returned, without a
// new Play generation. The final network handoff must discard that stale
// recommendation while retaining the live track/clock/volume wake reply.
for (const withConnectionEvent of [true, false]) {
  await p.queue.setAutoplayMode(Constants.AUTOPLAY_MODES.ENABLED);
  let navigationMutation, firstWakeRead = true;
  const beforeNavigationChange = await actualGetState();
  p.getState = () => {
    if (!firstWakeRead) return actualGetState();
    firstWakeRead = false;
    return Promise.resolve(beforeNavigationChange).then(value => {
      const mutate = () => { navigationMutation = p.queue.setAutoplayMode(Constants.AUTOPLAY_MODES.DISABLED); };
      // The explicit connection event has one additional async handler handoff.
      queueMicrotask(() => queueMicrotask(() => withConnectionEvent ? queueMicrotask(mutate) : mutate()));
      return value;
    });
  };
  yt.sent.length = 0;
  const wakeAID = withConnectionEvent ? 70 : 71;
  await api.incoming(app, new Message(wakeAID, 'loungeStatus', { devices,
    ...(withConnectionEvent ? { connectionEventDetails: JSON.stringify({ deviceId: sender.id }) } : {}) }), yt);
  p.getState = actualGetState;
  assert.ok(navigationMutation, 'navigation mutation must run at the outer incoming handoff');
  await navigationMutation;
  const sentWake = yt.sent.filter(message => message.AID === wakeAID);
  assert.ok(sentWake.some(message => message instanceof Message.NowPlaying),
    'a queue-only change must preserve the valid current track reply');
  assert.ok(!sentWake.some(message => message instanceof Message.AutoplayUpNext
    && message.payload.videoId === 'CCCCCCCCCCC'), 'stale ready candidate must not cross the final network handoff');
  assert.ok(!sentWake.some(message => message instanceof Message.OnHasPreviousNextChanged && message.payload.hasNext),
    'legacy lounge navigation must not send its former Next flag after the candidate changed');
  assert.ok(!sentWake.some(message => message instanceof Message.OnAutoplayModeChanged
    && message.payload.autoplayMode === Constants.AUTOPLAY_MODES.ENABLED),
  'legacy lounge navigation must not send its former autoplay mode after it changed');
  assert.deepEqual({ plays, stops, session: p.continuousSession }, wakeAudioBefore);
}

console.log('PASS: actual App/M1S restore track, cursor and volume after locked-phone wake; real Play/Stop races at both async handoffs and stale/live-queue reads are guarded; phone volume still reaches HA without restarting audio.');
