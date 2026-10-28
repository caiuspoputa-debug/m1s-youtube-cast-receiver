import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
import Playlist from '../node_modules/yt-cast-receiver/dist/lib/app/Playlist.js';
import RequestHandler from '../node_modules/yt-cast-receiver/dist/lib/app/PlaylistRequestHandler.js';
import Message from '../node_modules/yt-cast-receiver/dist/lib/app/Message.js';
import * as Errors from '../node_modules/yt-cast-receiver/dist/lib/utils/Errors.js';
import { createQueueHandler } from '../queue-handler.mjs';
import { normalizeM1sSelection, patchSelection } from '../patch-selection.mjs';

const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const dependency = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/Player.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default Player;', '');
const Base = new Function('EventEmitter', 'uuidv4', 'AUTOPLAY_MODES', 'PLAYER_STATUSES', 'Playlist',
  `${dependency}\nreturn Player;`)(EventEmitter, randomUUID, Constants.AUTOPLAY_MODES, Constants.PLAYER_STATUSES, Playlist);
const constants = source.slice(source.indexOf('const PCM_RATE ='), source.indexOf('function createStreamingWavHeader()'));
const sessionClass = source.slice(source.indexOf('class ContinuousAudioSession {'), source.indexOf('\nfunction nextStreamSerial()'));
const playerClass = source.slice(source.indexOf('class M1SPlayer extends Player {'), source.indexOf('\nasync function initializeVolume'));
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const safeVideoId = value => /^[A-Za-z0-9_-]{6,32}$/.test(String(value || '')) ? String(value) : null;
const Session = new Function('cfg', 'streamHost', 'safeVideoId', 'log',
  `${constants}\n${sessionClass}\nreturn ContinuousAudioSession;`)
  ({ audioPort: 8098 }, '127.0.0.1', safeVideoId, () => {});

// Evaluate the installed, patched app itself. Only the network Session is a
// test double; real incoming dispatch, Message, Playlist and M1S lifecycle run.
class NetworkSession extends EventEmitter {
  constructor(options) { super(); this.client = options.client; this.sent = []; }
  async begin() {}
  async end() {}
  async sendMessage(messages) { this.sent.push(...(Array.isArray(messages) ? messages : [messages])); }
}
const appSource = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default YouTubeApp;', '');
const appNames = ['EventEmitter', 'queryString', 'uuidv4', 'Message', 'Session', 'Sender',
  'AppError', 'SenderConnectionError', 'IncompleteAPIDataError', 'AUTOPLAY_MODES', 'STATUSES',
  'CONF_DEFAULTS', 'PLAYER_STATUSES', 'CLIENTS', 'MUTE_POLICIES', 'RESET_PLAYER_ON_DISCONNECT_POLICIES',
  'DefaultPlaylistRequestHandler'];
const appValues = [EventEmitter, { parse: data => Object.fromEntries(new URLSearchParams(data)) }, randomUUID,
  Message, NetworkSession, {}, Errors.AppError, Errors.SenderConnectionError, Errors.IncompleteAPIDataError,
  Constants.AUTOPLAY_MODES, Constants.STATUSES, Constants.CONF_DEFAULTS, Constants.PLAYER_STATUSES,
  Constants.CLIENTS, Constants.MUTE_POLICIES, Constants.RESET_PLAYER_ON_DISCONNECT_POLICIES, RequestHandler];
const appControl = new Function(...appNames, `${appSource}\nreturn {
  App: YouTubeApp, sessions: _YouTubeApp_sessions, active: _YouTubeApp_activeSession,
  senders: _YouTubeApp_connectedSenders,
  incoming: (app, message, session) => _YouTubeApp_handleIncomingMessage.call(app, message, session)
};`)(...appValues);

const oldId = 'aaaaaaaaaaa', newId = 'bbbbbbbbbbb', thirdId = 'ccccccccccc';
const S = Constants.PLAYER_STATUSES;
async function flush() { for (let i = 0; i < 200; i++) await Promise.resolve(); }
async function fixture(clientKey) {
  const services = [];
  const Player = new Function('Player', 'Constants', 'log', 'sleep', 'safeVideoId', 'getQuickYouTubeTitle',
    'setTimeout', 'haService', `${playerClass}\nreturn M1SPlayer;`)
    (Base, Constants, () => {}, async () => {}, safeVideoId, async () => 'Selected track',
      () => ({ unref() {} }), async (_entity, service) => services.push(service));
  const player = new Player({ name: 'Selection test', key: 'test', entityId: 'media_player.selection' });
  player.setLogger(logger); player.queue.setLogger(logger);
  class HandlerBase extends RequestHandler {
    async getPreviousNextVideos() { return { previous: null, next: null }; }
  }
  const Handler = createQueueHandler(HandlerBase, Constants.AUTOPLAY_MODES.ENABLED);
  const handler = new Handler(); handler.setLogger(logger); player.queue.setRequestHandler(handler);
  await player.queue.updateByMessage(new Message(1, 'setPlaylist', {
    listId: 'original-list', videoIds: `${oldId},${thirdId}`, videoId: oldId, currentIndex: '0'
  }), Constants.CLIENTS[clientKey]);
  const productionPlay = player.doPlay;
  player.doPlay = async video => {
    player.currentVideo = video; player.currentVideoId = video.id;
    player.title = 'Original track'; player.duration = 300;
    player.startedAt = Date.now(); return true;
  };
  await player.play(player.queue.current, 0);
  player.doPlay = productionPlay;
  player.targetStillOwnedByYoutube = async () => true;
  player.waitForPendingGroupSenderRestore = async () => {};
  player.scheduleHomeAssistantMetadata = () => {};
  player.waitUntilTargetStopped = async () => true;
  player.restoreIndividualGroupAfterStop = async () => {};
  const session = new Session(player, 17);
  session._decodeTrack = async () => {};
  session.transportLeadMs = 0;
  player.continuousSession = session; player.ownsTarget = true;
  const app = new appControl.App(player, { logger, playlistRequestHandler: handler,
    resetPlayerOnDisconnectPolicy: Constants.RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_EXPLICITLY_DISCONNECTED });
  await app.start();
  const network = appControl.sessions.get(app).YT;
  appControl.active.set(app, network);
  appControl.senders.set(app, [{ id: 'test-phone', name: 'Android', client: Constants.CLIENTS[clientKey] }]);
  const incomingSession = clientKey === 'YTMUSIC' ? appControl.sessions.get(app).YTMUSIC : network;
  const states = [];
  player.on('state', event => states.push(event.current));
  function begin(name, payload) {
    return appControl.incoming(app, new Message(42, name, payload), incomingSession);
  }
  function firstPcm() {
    const pcm = session.trackOutputStarts.get(session.currentTrackGeneration);
    if (session.active && pcm && !pcm.started && !pcm.cancelled) {
      pcm.started = true; pcm.resolve(Date.now());
    }
  }
  async function incoming(name, payload) {
    let settled = false;
    const result = begin(name, payload).finally(() => { settled = true; });
    await flush();
    firstPcm();
    await flush();
    assert.ok(settled, 'incoming selection must finish after the current first PCM');
    await result;
  }
  return { player, session, app, network, services, states, incoming, begin, firstPcm,
    async close() { await app.stop(); await session.stop(); } };
}

const selections = [
  { name: 'ordinary playlist', data: { listId: 'new-list', videoIds: newId, videoId: newId, currentIndex: '0' }, index: 0 },
  { name: 'missing playlist ID', data: { videoIds: newId, videoId: newId, currentIndex: '0' }, index: 0 },
  { name: 'empty playlist ID', data: { listId: '', videoIds: newId, videoId: newId, currentIndex: '0' }, index: 0 },
  { name: 'standalone video only', data: { videoId: newId }, index: 0 },
  { name: 'numeric zero', data: { listId: 'new-list', videoIds: newId, videoId: newId, currentIndex: 0 }, index: 0 },
  { name: 'inferred explicit queue index', data: { listId: 'new-list', videoIds: `${oldId},${newId},${thirdId}`, videoId: newId }, index: 1 }
];
for (const client of ['YT', 'YTMUSIC']) {
  for (const test of selections) {
    const f = await fixture(client);
    const original = structuredClone(test.data);
    await f.incoming('setPlaylist', test.data);
    assert.equal(f.player.queue.current.id, newId, `${client}: ${test.name}`);
    assert.equal(f.player.queue.current.context.index, test.index);
    assert.equal(f.player.currentVideoId, newId);
    assert.equal(f.player.status, S.PLAYING);
    assert.equal(f.player.continuousSession, f.session);
    assert.equal(f.session.active, true);
    assert.deepEqual(f.services, [], 'manual selection must not call HA Play/Stop');
    assert.ok(!f.states.some(state => state.status === S.STOPPED));
    assert.ok(!f.network.sent.some(message => message.name === 'loungeScreenDisconnected'));
    assert.deepEqual(test.data, original, 'normalization must not mutate the received payload');
    if (!test.data.listId) assert.equal(f.player.queue.id, null, 'do not invent a remote playlist ID');
    await f.close();
  }
  for (const test of [
    { name: 'empty clear', type: 'setPlaylist', data: {} },
    { name: 'explicit clear overrides selection', type: 'setPlaylist', data: {
      listId: 'new-list', videoIds: newId, videoId: newId, currentIndex: '0',
      eventDetails: JSON.stringify({ eventType: 'PLAYLIST_CLEARED' }) } },
    { name: 'current video removed', type: 'updatePlaylist', data: { listId: 'original-list', videoIds: newId } },
    { name: 'unsafe video ID', type: 'setPlaylist', data: { listId: 'new-list', videoIds: 'bad/video', videoId: 'bad/video', currentIndex: '0' } }
  ]) {
    const f = await fixture(client);
    await f.incoming(test.type, test.data);
    assert.equal(f.player.queue.current, null, `${client}: ${test.name}`);
    assert.equal(f.player.status, S.STOPPED);
    assert.equal(f.session.active, false);
    assert.deepEqual(f.services, ['media_stop']);
    await f.close();
  }
  const unchanged = await fixture(client);
  await unchanged.incoming('updatePlaylist', { listId: 'original-list', videoIds: `${oldId},${newId}` });
  assert.equal(unchanged.player.queue.current.id, oldId);
  assert.equal(unchanged.player.status, S.PLAYING);
  assert.equal(unchanged.session.active, true);
  assert.deepEqual(unchanged.services, []);
  await unchanged.close();
}

// Remote recommendations are advisory. The actual incoming App path must
// start new audio immediately after selecting it, before a slow lookup ends.
for (const client of ['YT', 'YTMUSIC']) {
  const f = await fixture(client);
  f.player.basePosition = 123;
  f.player.startedAt = Date.now();
  f.player.connectedSenderIds.add('test-phone');
  let resolveNavigation;
  f.player.queue.requestHandler.getPreviousNextVideos = () => new Promise(resolve => { resolveNavigation = resolve; });
  let settled = false;
  const incoming = f.begin('setPlaylist', { videoId: newId }).finally(() => { settled = true; });
  await flush();
  assert.equal(typeof resolveNavigation, 'function');
  assert.equal(settled, false, 'remote navigation remains pending');
  assert.equal(f.player.queue.current.id, newId);
  assert.equal(f.player.currentVideoId, newId, 'audio replacement starts while navigation is pending');
  assert.equal(f.player.status, S.LOADING);
  assert.equal(f.player.basePosition, 0);
  assert.equal(f.player.duration, 0);
  assert.equal(f.session.currentTrackGeneration, 1);
  await f.player.publishProgress();
  assert.ok(!f.states.some(state => state.queue.current?.id === newId
    && (state.position >= 123 || state.duration === 300)), 'never publish a new ID with the predecessor clock');
  f.firstPcm();
  await flush();
  assert.equal(f.player.status, S.PLAYING, 'navigation cannot delay first audio');
  assert.equal(settled, false);
  resolveNavigation({ previous: null, next: { id: thirdId, client: Constants.CLIENTS[client] } });
  await incoming;
  assert.equal(f.session.currentTrackGeneration, 1, 'completion must not Play twice');
  assert.equal(f.player.currentVideoId, newId);
  assert.equal(f.session.active, true);
  assert.deepEqual(f.services, []);
  await f.close();

  const superseded = await fixture(client);
  const pending = new Map();
  superseded.player.queue.requestHandler.getPreviousNextVideos = target => new Promise(resolve => pending.set(target.id, resolve));
  const before = superseded.begin('setPlaylist', { videoId: newId });
  await flush();
  const current = superseded.begin('setPlaylist', { videoId: thirdId });
  await flush();
  if (client === 'YTMUSIC') {
    // YTM's existing target-start serialization is preserved. Complete the
    // preceding first PCM before checking that its successor starts.
    superseded.firstPcm();
    await flush();
  }
  assert.equal(superseded.player.currentVideoId, thirdId);
  superseded.firstPcm();
  pending.get(thirdId)({ previous: null, next: null });
  await current;
  const generation = superseded.session.currentTrackGeneration;
  pending.get(newId)({ previous: null, next: { id: oldId } });
  await before;
  assert.equal(superseded.player.currentVideoId, thirdId);
  assert.equal(superseded.player.queue.current.id, thirdId);
  assert.equal(superseded.player.status, S.PLAYING);
  assert.equal(superseded.session.currentTrackGeneration, generation);
  assert.ok(!superseded.states.some(state => state.status === S.STOPPED));
  assert.deepEqual(superseded.services, []);
  await superseded.close();

  const cleared = await fixture(client);
  let finishStaleNavigation;
  cleared.player.queue.requestHandler.getPreviousNextVideos = () => new Promise(resolve => { finishStaleNavigation = resolve; });
  const staleSelection = cleared.begin('setPlaylist', { videoId: newId });
  await flush();
  await cleared.incoming('setPlaylist', { eventDetails: JSON.stringify({ eventType: 'PLAYLIST_CLEARED' }) });
  assert.equal(cleared.player.queue.current, null);
  assert.equal(cleared.player.status, S.STOPPED);
  assert.equal(cleared.session.active, false);
  finishStaleNavigation({ previous: null, next: { id: thirdId } });
  await staleSelection;
  assert.equal(cleared.player.queue.current, null, 'late lookup cannot undo explicit clear');
  assert.equal(cleared.player.status, S.STOPPED);
  assert.deepEqual(cleared.services, ['media_stop']);
  await cleared.close();

  const failed = await fixture(client);
  let rejectNavigation;
  failed.player.queue.requestHandler.getPreviousNextVideos = () => new Promise((_resolve, reject) => { rejectNavigation = reject; });
  const selection = failed.begin('setPlaylist', { videoId: newId });
  await flush();
  failed.firstPcm();
  rejectNavigation(new Error('remote navigation unavailable'));
  await selection;
  assert.equal(failed.player.currentVideoId, newId);
  assert.equal(failed.player.status, S.PLAYING);
  assert.equal(failed.session.active, true);
  assert.deepEqual(failed.services, []);
  await failed.close();

  for (const ignoresAbort of [false, true]) {
    const rapid = await fixture(client);
    await rapid.player.queue.setAutoplayMode(Constants.AUTOPLAY_MODES.ENABLED);
    const deferred = new Map();
    rapid.player.queue.requestHandler.getPreviousNextVideos = target => new Promise(resolve => deferred.set(target.id, resolve));
    if (ignoresAbort) {
      rapid.player.queue.requestHandler.getPreviousNextVideosAbortable = target =>
        rapid.player.queue.requestHandler.getPreviousNextVideos(target);
    }
    const fourthId = 'ddddddddddd', nextId = 'eeeeeeeeeee';
    const b = rapid.begin('setPlaylist', { videoId: newId });
    await flush(); rapid.firstPcm(); await flush();
    const c = rapid.begin('setPlaylist', { videoId: thirdId });
    await flush(); rapid.firstPcm(); await flush();
    deferred.get(newId)({ previous: null, next: { id: oldId } });
    await b;
    assert.equal(rapid.player.queue.isUpdating, true, 'stale B finally must retain C controller');
    const d = rapid.begin('setPlaylist', { videoId: fourthId });
    await flush(); rapid.firstPcm(); await flush();
    deferred.get(fourthId)({ previous: null, next: { id: nextId } });
    await d;
    deferred.get(thirdId)({ previous: null, next: { id: oldId } });
    await c;
    assert.equal(rapid.player.queue.current.id, fourthId);
    assert.equal(rapid.player.currentVideoId, fourthId);
    assert.equal(rapid.player.queue.autoplay.id, nextId, 'late navigation cannot overwrite the latest successor');
    assert.equal(rapid.player.status, S.PLAYING);
    assert.equal(rapid.session.active, true);
    assert.ok(!rapid.states.some(state => state.status === S.STOPPED));
    assert.deepEqual(rapid.services, []);
    await rapid.close();
  }
}

// A pristine pinned-source fixture proves that an absent/repeated patch or an
// unexpected dependency cannot silently produce a partially patched install.
const installed = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/Playlist.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const marker = '// M1S selection payload patch v2: standalone video, zero index and navigation identity';
assert.ok(installed.startsWith(`${marker}\n`));
const pristine = installed.replace(`${marker}\n${normalizeM1sSelection.toString()}\n`, '')
  .replace('        const data = normalizeM1sSelection(message);\n        if (!data.listId && !data.__m1sSelectedVideo) {',
    '        const data = message.payload;\n        if (!data.listId) {')
  .replace('            if (data.__m1sSelectedVideo) {', '            if (data.currentIndex && data.videoId) {')
  .replace(`            const m1sNavigationVideo = __classPrivateFieldGet(this, _Playlist_current, "f");
            const m1sNavigationController = new AbortController();
            __classPrivateFieldSet(this, _Playlist_previousNextAbortController, m1sNavigationController, "f");`,
    '            __classPrivateFieldSet(this, _Playlist_previousNextAbortController, new AbortController(), "f");')
  .replace(`                nav = await __classPrivateFieldGet(this, _Playlist_requestHandler, "f").getPreviousNextVideosAbortable(m1sNavigationVideo, this, m1sNavigationController.signal);
                if (m1sNavigationController.signal.aborted
                    || __classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f") !== m1sNavigationController
                    || __classPrivateFieldGet(this, _Playlist_current, "f") !== m1sNavigationVideo) return;`,
    '                nav = await __classPrivateFieldGet(this, _Playlist_requestHandler, "f").getPreviousNextVideosAbortable(__classPrivateFieldGet(this, _Playlist_current, "f"), this, __classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f").signal);')
  .replace(`                if (__classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f") === m1sNavigationController) {
                    __classPrivateFieldSet(this, _Playlist_previousNextAbortController, null, "f");
                }`, '                __classPrivateFieldSet(this, _Playlist_previousNextAbortController, null, "f");');
assert.ok(!pristine.includes('normalizeM1sSelection'));
assert.ok(!pristine.includes('m1sNavigation'));
const installedApp = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const appMarker = '// M1S explicit selection starts before remote navigation';
assert.ok(installedApp.includes(`${appMarker}\n`));
// Other independent postinstall diagnostics may prepend their own helper.
const expectedApp = `${appMarker}\n` + installedApp.replace(`${appMarker}\n`, '');
let pristineApp = installedApp.replace(`${appMarker}\n`, '');
const dispatchStart = pristineApp.indexOf('            const m1sSelectionToken =');
const dispatchEnd = pristineApp.indexOf('            const stateAfterSet =', dispatchStart);
assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart);
pristineApp = pristineApp.slice(0, dispatchStart)
  + '            await __classPrivateFieldGet(this, _YouTubeApp_player, "f").queue.updateByMessage(message, client);\n'
  + pristineApp.slice(dispatchEnd);
const playStart = pristineApp.indexOf('                    if (m1sEarlyPlay) {');
const playEnd = pristineApp.indexOf('                    }\n', pristineApp.indexOf('                    } else {', playStart));
assert.ok(playStart >= 0 && playEnd > playStart);
pristineApp = pristineApp.slice(0, playStart)
  + '                    await __classPrivateFieldGet(this, _YouTubeApp_player, "f").play(currentVideo, parseInt(payload.currentTime, 10) || 0, AID);\n'
  + pristineApp.slice(playEnd + '                    }\n'.length);
assert.ok(!pristineApp.includes('m1sEarlyPlay'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'm1s-selection-patch-'));
try {
  const target = path.join(temporary, 'dist/lib/app/Playlist.js');
  const appTarget = path.join(temporary, 'dist/lib/app/YouTubeApp.js');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const packageFile = path.join(temporary, 'package.json');
  fs.writeFileSync(packageFile, JSON.stringify({ version: '2.1.0' }));
  fs.writeFileSync(target, pristine);
  fs.writeFileSync(appTarget, pristineApp);
  assert.equal(patchSelection(temporary), true);
  assert.equal(fs.readFileSync(target, 'utf8'), installed);
  assert.equal(fs.readFileSync(appTarget, 'utf8'), expectedApp);
  assert.equal(patchSelection(temporary), false);
  assert.equal(fs.readFileSync(target, 'utf8'), installed);
  assert.equal(fs.readFileSync(appTarget, 'utf8'), expectedApp);
  const legacy = '// M1S selection payload patch: standalone video and numeric zero\n'
    + normalizeM1sSelection.toString() + '\n' + pristine
      .replace('        const data = message.payload;\n        if (!data.listId) {',
        '        const data = normalizeM1sSelection(message);\n        if (!data.listId && !data.__m1sSelectedVideo) {')
      .replace('            if (data.currentIndex && data.videoId) {', '            if (data.__m1sSelectedVideo) {');
  fs.writeFileSync(target, legacy);
  assert.equal(patchSelection(temporary), true, 'upgrade an already normalized install without duplicate helpers');
  assert.equal(fs.readFileSync(target, 'utf8'), installed);
  assert.equal(patchSelection(temporary), false);
  fs.writeFileSync(packageFile, JSON.stringify({ version: '2.1.1' }));
  assert.throws(() => patchSelection(temporary), /exact yt-cast-receiver 2.1.0/);
  assert.equal(fs.readFileSync(target, 'utf8'), installed);
  fs.writeFileSync(packageFile, JSON.stringify({ version: '2.1.0' }));
  const unexpected = pristine.replace('if (data.currentIndex && data.videoId)', 'if (unexpectedSelectionShape)');
  fs.writeFileSync(target, unexpected);
  assert.throws(() => patchSelection(temporary), /refusing partial selection patch/);
  assert.equal(fs.readFileSync(target, 'utf8'), unexpected);
  assert.equal(fs.readFileSync(appTarget, 'utf8'), expectedApp);
  fs.writeFileSync(target, pristine);
  const unexpectedApp = pristineApp.replace('queue.updateByMessage(message, client)', 'queue.changedDependencyAPI(message, client)');
  fs.writeFileSync(appTarget, unexpectedApp);
  assert.throws(() => patchSelection(temporary), /refusing partial selection patch/);
  assert.equal(fs.readFileSync(target, 'utf8'), pristine, 'App drift must not leave Playlist half patched');
  assert.equal(fs.readFileSync(appTarget, 'utf8'), unexpectedApp);
} finally {
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('PASS: actual App + pinned Playlist + M1S/session select standalone/indexed videos through YT/YTM without HA Stop; immediate Play while remote navigation waits, superseded lookup and navigation failure safe; explicit clear/removal preserved; patch pinned, idempotent and atomic across both files.');
