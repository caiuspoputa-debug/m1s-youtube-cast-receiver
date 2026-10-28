import assert from 'node:assert/strict';
import fs from 'node:fs';
import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import * as Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
import Player from '../node_modules/yt-cast-receiver/dist/lib/Player.js';
import Message from '../node_modules/yt-cast-receiver/dist/lib/app/Message.js';
import Sender from '../node_modules/yt-cast-receiver/dist/lib/app/Sender.js';
import PlaylistRequestHandler from '../node_modules/yt-cast-receiver/dist/lib/app/PlaylistRequestHandler.js';
import { AppError, SenderConnectionError, IncompleteAPIDataError } from '../node_modules/yt-cast-receiver/dist/lib/utils/Errors.js';
import { createQueueHandler } from '../queue-handler.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const sessions = [];
class Session extends EventEmitter {
  constructor(options) { super(); this.client = options.client; this.sent = []; sessions.push(this); }
  async begin() {}
  async end() {}
  async registerPairingCode() {}
  async sendMessage(messages) { this.sent.push(...(Array.isArray(messages) ? messages : [messages])); }
}
let remoteCalls = 0;
class Remote extends PlaylistRequestHandler {
  async getPreviousNextVideos() { remoteCalls++; return { previous: null, next: null }; }
}
const QueueHandler = createQueueHandler(Remote, Constants.AUTOPLAY_MODES.ENABLED);
const appSource = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js', import.meta.url), 'utf8');
const dependencies = { EventEmitter, queryString: { parse: value => Object.fromEntries(new URLSearchParams(value)) },
  uuidv4: randomUUID, Message, Session, Sender, AppError, SenderConnectionError, IncompleteAPIDataError,
  ...Constants, DefaultPlaylistRequestHandler: Remote };
delete dependencies.default;
const appCode = appSource.replace(/^import .*;\r?\n/gm, '').replace('export default YouTubeApp;', '');
const api = new Function(...Object.keys(dependencies), `${appCode}
return { App: YouTubeApp,
  connected: (app, sender, session) => _YouTubeApp_handleSenderConnected.call(app, sender, session)
};`)(...Object.values(dependencies));
const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const playerCode = source.slice(source.indexOf('class M1SPlayer extends Player {'), source.indexOf('\nasync function initializeVolume'));
const M1S = new Function('Player', 'Constants', 'log', 'sleep', `${playerCode}\nreturn M1SPlayer;`)
  (Player, Constants, () => {}, async () => {});
const queueCode = source.slice(source.indexOf('function installQueueLogging(player) {'), source.indexOf('\nreceiverDefinitions = await discoverReceiverDefinitions()'));
const installQueueLogging = new Function('log', `${queueCode}\nreturn installQueueLogging;`)(() => {});
const [A, B, C] = ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC'];
const settle = async predicate => {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'asynchronous ready publication must complete without a periodic timer');
};

for (const theme of ['cl', 'm']) {
  const p = new M1S({ name: `Navigation ${theme}`, key: `nav-${theme}`, entityId: 'media_player.navigation' });
  let plays = 0, stops = 0;
  p.doPlay = async (video, position) => {
    plays++; p.playGeneration++; p.currentVideo = video; p.currentVideoId = video.id;
    p.basePosition = position; p.startedAt = Date.now(); p.duration = 100; p.paused = false;
    return true;
  };
  p.doStop = async () => { stops++; return true; };
  p.continuousSession = { active: true };
  p.ownsTarget = true;
  installQueueLogging(p);
  const handler = new QueueHandler(); handler.setLogger(logger);
  const sessionStart = sessions.length;
  const app = new api.App(p, { logger, screenName: 'Navigation', enableAutoplayOnConnect: false,
    playlistRequestHandler: handler, mutePolicy: Constants.MUTE_POLICIES.PRESERVE_VOLUME_LEVEL,
    resetPlayerOnDisconnectPolicy: Constants.RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_EXPLICITLY_DISCONNECTED });
  app.on('senderConnect', sender => p.noteSenderConnected(sender));
  await app.start(); await app.launch(`pairingCode=safe&theme=${theme}`);
  const session = sessions.slice(sessionStart).find(value => value.client.key === (theme === 'm' ? 'YTMUSIC' : 'YT'));
  const sender = Sender.parse({ id: `phone-${theme}`, name: 'Phone', theme, capabilities: '' });
  await p.queue.updateByMessage({ name: 'setPlaylist', payload: {
    listId: 'explicit', videoIds: [A, B, C].join(','), videoId: A, currentIndex: '0'
  } }, session.client);
  await p.play(p.queue.current, 0); await api.connected(app, sender, session);
  await settle(() => !p.progressPublishing);
  session.sent.length = 0;
  const audioBefore = { plays, stops, session: p.continuousSession };
  const actualGetState = p.getState.bind(p);
  let finishNavigation;
  p.queue.setRequestHandler({ getPreviousNextVideosAbortable: () => new Promise(resolve => { finishNavigation = resolve; }), reset() {} });
  const update = p.queue.updateByMessage({ name: 'updatePlaylist', payload: {
    listId: 'explicit', videoIds: [A, B, C].join(',')
  } }, session.client);
  assert.equal(p.queue.isUpdating, true);
  await p.publishProgress();
  assert.equal(session.sent.length, 0, 'pending navigation must not advertise a false Next through full progress snapshots');
  finishNavigation({ previous: null, next: { id: B, client: session.client, context: { playlistId: 'explicit', index: 1 } } });
  await update;
  await settle(() => session.sent.some(message => message instanceof Message.OnHasPreviousNextChanged));
  assert.equal(session.sent.find(message => message instanceof Message.OnHasPreviousNextChanged).payload.hasNext, true);
  assert.equal(session.sent.find(message => message instanceof Message.NowPlaying).payload.videoId, A);
  assert.ok(!p.progressTimer, 'ready publication does not require or create a timer');

  // At the end of the explicit queue, autoplayUpNext is the protocol's actual
  // successor identity. A boolean Next flag alone cannot restore its preview.
  session.sent.length = 0;
  const lastUpdate = p.queue.updateByMessage({ name: 'updatePlaylist', payload: { listId: 'last', videoIds: A } }, session.client);
  finishNavigation({ previous: null, next: null }); await lastUpdate;
  const autoplayUpdate = p.queue.setAutoplayMode(Constants.AUTOPLAY_MODES.ENABLED);
  assert.equal(p.queue.isUpdating, true);
  finishNavigation({ previous: null, next: { id: C, client: session.client } });
  await autoplayUpdate;
  await settle(() => session.sent.some(message => message instanceof Message.AutoplayUpNext && message.payload.videoId === C));
  assert.equal(session.sent.findLast(message => message instanceof Message.OnHasPreviousNextChanged).payload.hasNext, true);
  assert.equal(session.sent.findLast(message => message instanceof Message.NowPlaying).payload.videoId, A);

  // A ready event arriving behind a pending state read is coalesced. The older
  // getState queue snapshot cannot overwrite the newly resolved successor.
  await settle(() => !p.progressPublishing);
  session.sent.length = 0;
  const older = await actualGetState();
  let finishState, reading = false;
  p.getState = () => { reading = true; return new Promise(resolve => { finishState = resolve; }); };
  const publication = p.publishProgress(); await settle(() => reading);
  p.publishNavigationState();
  older.queue = { ...older.queue, next: null, autoplay: null };
  finishState(older); await publication;
  p.getState = actualGetState;
  await settle(() => !p.progressPublishing);
  assert.equal(session.sent.filter(message => message instanceof Message.NowPlaying).length, 1);
  assert.equal(session.sent.find(message => message instanceof Message.AutoplayUpNext).payload.videoId, C);
  assert.equal(p.navigationPublicationPending, false);

  // Source replacement/Stop/ownership changes while reading must never publish
  // the previous session's navigation, nor an empty current video.
  for (const change of ['generation', 'session', 'ownership', 'liveQueue', 'loading']) {
    session.sent.length = 0;
    const saved = { generation: p.playGeneration, session: p.continuousSession, owns: p.ownsTarget };
    const snapshot = await actualGetState();
    let resolve;
    p.getState = () => new Promise(value => { resolve = value; });
    const pending = p.publishNavigationState();
    await settle(() => Boolean(resolve));
    if (change === 'generation') p.playGeneration++;
    if (change === 'session') p.continuousSession = { active: true };
    if (change === 'ownership') p.ownsTarget = false;
    if (change === 'liveQueue') Object.defineProperty(p.queue, 'current', { configurable: true, value: { id: B } });
    if (change === 'loading') Object.defineProperty(p, 'status', { configurable: true, value: Constants.PLAYER_STATUSES.LOADING });
    resolve(snapshot); await pending;
    assert.equal(session.sent.length, 0, `stale ${change} ready snapshot must be skipped`);
    if (change === 'liveQueue') delete p.queue.current;
    if (change === 'loading') delete p.status;
    p.playGeneration = saved.generation; p.continuousSession = saved.session; p.ownsTarget = saved.owns;
    p.getState = actualGetState;
  }
  assert.equal(plays, audioBefore.plays); assert.equal(stops, audioBefore.stops);
  assert.equal(p.continuousSession, audioBefore.session);
}
assert.equal(remoteCalls, 0, 'ordinary explicit queues retain their local navigation semantics');
console.log('PASS: actual YT/YTM App and M1S Player publish ready navigation/autoplay identity immediately, suppress transient false Next progress, coalesce pending reads, and guard stale sessions without audio commands or timers.');
