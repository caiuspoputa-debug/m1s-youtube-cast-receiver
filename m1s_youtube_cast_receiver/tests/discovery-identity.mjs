import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EventEmitter from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as C from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
import Player from '../node_modules/yt-cast-receiver/dist/lib/Player.js';
import Message from '../node_modules/yt-cast-receiver/dist/lib/app/Message.js';
import Sender from '../node_modules/yt-cast-receiver/dist/lib/app/Sender.js';
import RPC from '../node_modules/yt-cast-receiver/dist/lib/app/RPCConnection.js';
import * as Errors from '../node_modules/yt-cast-receiver/dist/lib/utils/Errors.js';
import { patchDiscoveryApp, patchDiscoverySession, installDiscoveryIdentity } from '../patch-discovery-identity.mjs';

const root = new URL('../node_modules/yt-cast-receiver/', import.meta.url);
const appURL = new URL('dist/lib/app/YouTubeApp.js', root);
const sessionURL = new URL('dist/lib/app/Session.js', root);
const stripApp = value => value.replace(/^\/\/ M1S discovery identity handshake with bounded per-session replies\n[\s\S]*?^}\n(?=\/\/ M1S|function normalizeM1sSelection)/m, '')
  .replace(/        case 'getDiscoveryDeviceId': \{[\s\S]*?(?=        case 'getNowPlaying': \{)/, '')
  .replace('        m1sClearDiscoveryIdentity(this);\n', '');
const stripSession = value => value.replace(/^    \/\/ M1S discovery identity reads the persisted Lounge device ID\n[\s\S]*?(?=    get client\(\) \{)/m, '');
const originalApp = stripApp(fs.readFileSync(appURL, 'utf8').replace(/\r\n/g, '\n'));
const originalSession = stripSession(fs.readFileSync(sessionURL, 'utf8').replace(/\r\n/g, '\n'));
const appSource = patchDiscoveryApp(originalApp, '2.1.0');
const sessionSource = patchDiscoverySession(originalSession, '2.1.0');
assert.equal(patchDiscoveryApp(appSource, '2.1.0'), appSource);
assert.equal(patchDiscoverySession(sessionSource, '2.1.0'), sessionSource);
assert.equal(patchDiscoveryApp('// Other patch\n' + appSource, '2.1.0'), '// Other patch\n' + appSource);
assert.throws(() => patchDiscoveryApp(originalApp, '2.1.1'), /requires.*2\.1\.0/);
assert.throws(() => patchDiscoverySession(originalSession, '2.1.1'), /requires.*2\.1\.0/);
assert.throws(() => patchDiscoveryApp(appSource.replace('m1sClearDiscoveryIdentity(this);', 'changedCleanup(this);'), '2.1.0'), /patched target mismatch/);

// Real Session.begin restores the persisted MDX device ID before RPC opens.
// Only HTTP/RPC I/O is substituted, not the Session or BindParams lifecycle.
const require = createRequire(sessionURL);
const absolute = source => source.replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier === 'events' ? 'node:events'
  : specifier.startsWith('.') ? new URL(specifier, sessionURL).href : pathToFileURL(require.resolve(specifier)).href}'`);
const realSource = `const fixtureTimers = new Set();
const setTimeout = (...args) => { const timer = globalThis.setTimeout(...args); fixtureTimers.add(timer); return timer; };
export const clearFixtureTimers = () => { for (const timer of fixtureTimers) globalThis.clearTimeout(timer); fixtureTimers.clear(); };\n`
  + absolute(sessionSource) + '\nexport const bindFixture = value => _Session_bindParams.get(value);';
const { default: RealSession, bindFixture, clearFixtureTimers } = await import(`data:text/javascript;base64,${Buffer.from(realSource).toString('base64')}`);
const traces = [];
const logger = { debug() {}, info(value) { traces.push(String(value)); }, warn() {}, error() {} };
const originalFetch = global.fetch, originalConnect = RPC.prototype.connect, originalDisconnect = RPC.prototype.disconnect;
const channelCounts = new Map(), stored = new Map(), writes = [];
const identities = new Map();
const realSessions = [];
for (const client of [C.CLIENTS.YT, C.CLIENTS.YTMUSIC]) {
  stored.set(`mdxContext.${client.theme}`, { deviceId: `persisted-lounge-${client.theme}-fixture`, screenId: `different-screen-${client.theme}` });
}
RPC.prototype.connect = async () => {};
RPC.prototype.disconnect = async () => {};
global.fetch = async (url, request) => {
  if (url.includes('get_lounge_token_batch')) return { json: async () => ({ screens: [{ loungeToken: 'private-fixture-token', refreshIntervalInMillis: 1000000 }] }) };
  const query = new URL(url).searchParams;
  if (String(request?.body?.get('count')) === '0') {
    const theme = query.get('theme');
    const number = (channelCounts.get(theme) || 0) + 1; channelCounts.set(theme, number);
    return { text: async () => `[0,["c","private-channel-${theme}-${number}","",8]]\n[1,["S","private-session-${theme}"]]` };
  }
  return { ok: true, status: 200 };
};
try {
  for (const client of [C.CLIENTS.YT, C.CLIENTS.YTMUSIC]) {
    const session = new RealSession({ client, logger, screenName: 'Identity fixture', dataStore: {
      async get(key) { return stored.get(key); },
      async set(key, value) { writes.push([key, value]); }
    } });
    realSessions.push(session);
    assert.equal(session.discoveryIdentityReady, false);
    await session.begin();
    assert.equal(session.discoveryDeviceId, stored.get(`mdxContext.${client.theme}`).deviceId);
    assert.notEqual(session.discoveryDeviceId, stored.get(`mdxContext.${client.theme}`).screenId);
    assert.equal(session.discoveryIdentityReady, true);
    assert.equal(session.discoveryIdentitySessionId, bindFixture(session).SID);
    assert.throws(() => { session.discoveryDeviceId = 'replacement-forbidden'; }, TypeError);
    const savedId = session.discoveryDeviceId;
    await session.end(); assert.equal(session.discoveryIdentityReady, false);
    await session.begin(); assert.equal(session.discoveryDeviceId, savedId);
    identities.set(client.key, session);
  }
  assert.equal(new Set([...identities.values()].map(session => session.discoveryDeviceId)).size, 2, 'never unify YT/YTM identities');
  assert.equal(writes.length, 4, 'getter adds no persistence writes beyond normal begin');

  class Clock {
    constructor() { this.now = 0; this.tasks = new Map(); this.sequence = 0; }
    interval(callback, period) { const task = { id: ++this.sequence, callback, period, due: this.now + period, unref() {} }; this.tasks.set(task.id, task); return task; }
    clear(task) { if (task) this.tasks.delete(task.id); }
    async advance(milliseconds) {
      const end = this.now + milliseconds;
      while (true) {
        const next = [...this.tasks.values()].filter(task => task.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        this.now = next.due; next.due += next.period; next.callback();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      this.now = end;
    }
  }
  const clock = new Clock();
  class NetworkSession extends EventEmitter {
    constructor(options) { super(); this.client = options.client; this.source = identities.get(options.client.key); this.sent = []; this.running = false; this.fail = false; this.pending = false; }
    get discoveryDeviceId() { return this.source.discoveryDeviceId; }
    get discoveryIdentitySessionId() { return this.source.discoveryIdentitySessionId; }
    get discoveryIdentityReady() { return this.running && this.source.discoveryIdentityReady; }
    async begin() { this.running = true; }
    async end() { this.running = false; }
    sendMessage(messages) {
      if (this.fail) return Promise.reject(Error('private-fixture-token should never be logged'));
      this.sent.push(...(Array.isArray(messages) ? messages : [messages]).map(message => ({ message, at: clock.now })));
      return this.pending ? new Promise(() => {}) : Promise.resolve(true);
    }
  }
  class Handler { setLogger() {} reset() {} async getPreviousNextVideosAbortable() { return { previous: null, next: null }; } }
  const deps = { EventEmitter, queryString: {}, uuidv4: randomUUID, Message, Session: NetworkSession, Sender,
    AppError: Errors.AppError, SenderConnectionError: Errors.SenderConnectionError, IncompleteAPIDataError: Errors.IncompleteAPIDataError,
    ...C, DefaultPlaylistRequestHandler: Handler,
    setInterval: clock.interval.bind(clock), clearInterval: clock.clear.bind(clock) };
  delete deps.default;
  const appCode = appSource.replace(/^import .*;\r?\n/gm, '').replace('export default YouTubeApp;', '');
  const api = new Function(...Object.keys(deps), `${appCode}\nreturn {
    App:YouTubeApp, active:_YouTubeApp_activeSession, sessions:_YouTubeApp_sessions,
    incoming:(app,message,session)=>_YouTubeApp_handleIncomingMessage.call(app,message,session)
  };`)(...Object.values(deps));
  class ProbePlayer extends Player {
    constructor() { super(); this.definition = { name: 'MP Cezara\nfixture' }; this.volume = { level: 10, muted: false }; this.connectedSenderIds = new Set(); this.calls = { next: 0, volume: 0, play: 0, stop: 0 }; }
    async doGetPosition() { return 12; } async doGetDuration() { return 100; } async doGetVolume() { return this.volume; }
    async doPlay() { this.calls.play++; return true; } async doStop() { this.calls.stop++; return true; }
    async next() { this.calls.next++; return true; }
    async setPhoneVolume() { this.calls.volume++; return true; }
    noteSenderConnected(sender) { this.connectedSenderIds.add(sender.id); }
  }
  const player = new ProbePlayer();
  const app = new api.App(player, { logger, playlistRequestHandler: new Handler(), resetPlayerOnDisconnectPolicy: C.RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_EXPLICITLY_DISCONNECTED });
  await app.start();
  const channels = api.sessions.get(app), yt = channels.YT, ytm = channels.YTMUSIC;
  api.active.set(app, yt);
  const invoke = (session, name) => api.incoming(app, new Message(12, name, {}), session);
  const replies = session => session.sent.filter(item => item.message.name === 'setDiscoveryDeviceId');
  const baseline = structuredClone(player.calls), queue = player.queue.getState();
  for (const session of [yt, ytm]) await invoke(session, 'getDiscoveryDeviceId');
  for (const session of [yt, ytm]) {
    assert.equal(replies(session).length, 1);
    assert.deepEqual(replies(session)[0].message.payload, { discoveryDeviceId: session.source.discoveryDeviceId, loungeDeviceId: session.source.discoveryDeviceId });
  }
  assert.equal(api.active.get(app), yt, 'inactive-session identity replies grant no control');
  assert.deepEqual(player.queue.getState(), queue);
  assert.deepEqual(player.calls, baseline);
  const oldCallback = [...clock.tasks.values()][0].callback;
  await invoke(yt, 'getDiscoveryDeviceId'); assert.equal(replies(yt).length, 1, 'repeated pending requests coalesce');
  await invoke(yt, 'onSetDiscoveryDeviceId');
  await clock.advance(10000); assert.equal(replies(yt).length, 1); assert.equal(replies(ytm).length, 2, 'YT ACK leaves YTM pending');
  await invoke(yt, 'getDiscoveryDeviceId');
  oldCallback(); await clock.advance(10000);
  assert.equal(replies(yt).length, 3, 'old queued callback cannot cancel a newer job');
  await invoke(yt, 'onSetDiscoveryDeviceId'); await invoke(ytm, 'onSetDiscoveryDeviceId');
  assert.equal(clock.tasks.size, 0);

  yt.sent.length = 0;
  const start = clock.now; await invoke(yt, 'getDiscoveryDeviceId');
  await clock.advance(50000);
  assert.deepEqual(replies(yt).map(item => item.at - start), [0, 10000, 20000, 30000, 40000]);
  assert.equal(clock.tasks.size, 0, 'fifth interval ends without a sixth reply');
  await clock.advance(50000); assert.equal(replies(yt).length, 5);

  yt.sent.length = 0; await invoke(yt, 'getDiscoveryDeviceId');
  const idBefore = yt.discoveryDeviceId;
  await yt.source.end(); await yt.source.begin();
  assert.equal(yt.discoveryDeviceId, idBefore);
  await clock.advance(10000); assert.equal(replies(yt).length, 1, 'new logical SID invalidates old retries between ticks');
  await invoke(yt, 'getDiscoveryDeviceId'); assert.equal(replies(yt).length, 2);
  await invoke(yt, 'onSetDiscoveryDeviceId');
  await yt.source.end(); await invoke(yt, 'getDiscoveryDeviceId'); assert.equal(replies(yt).length, 2, 'ended Session cannot enqueue identity replies');
  await yt.source.begin();
  const channel = bindFixture(yt.source), savedSID = channel.SID;
  delete channel.SID;
  assert.equal(yt.source.discoveryIdentityReady, false, 'refresh window without SID is not ready');
  await invoke(yt, 'getDiscoveryDeviceId'); assert.equal(replies(yt).length, 2);
  channel.SID = savedSID;

  yt.fail = true; await invoke(yt, 'getDiscoveryDeviceId'); await clock.advance(50000); yt.fail = false;
  assert.equal(clock.tasks.size, 0, 'rejected sends remain bounded and do not throw');
  yt.pending = true; yt.sent.length = 0; await invoke(yt, 'getDiscoveryDeviceId'); await clock.advance(50000);
  assert.equal(replies(yt).length, 5, 'stalled sends do not block the official retry cadence'); yt.pending = false;
  assert.deepEqual(player.calls, baseline); assert.equal(api.active.get(app), yt);
  assert.deepEqual(player.queue.getState(), queue);
  api.active.set(app, ytm);
  const beforeInactiveReply = replies(yt).length;
  await invoke(yt, 'getDiscoveryDeviceId'); assert.equal(replies(yt).length, beforeInactiveReply + 1);
  await api.incoming(app, new Message(17, 'next', {}), yt);
  await api.incoming(app, new Message(18, 'setVolume', { volume: '11', muted: false }), yt);
  assert.deepEqual(player.calls, baseline, 'an inactive generic YT identity reply grants no playback or volume control');
  assert.equal(api.active.get(app), ytm);
  await invoke(yt, 'onSetDiscoveryDeviceId'); api.active.set(app, yt);
  await api.incoming(app, new Message(19, 'next', {}), yt);
  await api.incoming(app, new Message(20, 'setVolume', { volume: '11', muted: false }), yt);
  assert.deepEqual(player.calls, { ...baseline, next: baseline.next + 1, volume: baseline.volume + 1 }, 'existing controls still dispatch normally');
  await invoke(yt, 'getDiscoveryDeviceId'); await invoke(ytm, 'getDiscoveryDeviceId');
  const countBeforeStop = replies(yt).length + replies(ytm).length;
  const stopping = app.stop(); assert.equal(clock.tasks.size, 0, 'App.stop clears jobs before awaiting player/session work');
  await invoke(yt, 'getDiscoveryDeviceId'); await stopping; await clock.advance(100000);
  assert.equal(replies(yt).length + replies(ytm).length, countBeforeStop);
  const identityLogs = traces.filter(line => line.includes('event=discovery_identity_'));
  assert.ok(identityLogs.some(line => line.includes('[MP Cezara fixture] event=discovery_identity_request')));
  for (const line of identityLogs) assert.ok(!/persisted-lounge|different-screen|private-|discoveryDeviceId=|loungeDeviceId=/.test(line), 'identity logs contain no IDs, SID or tokens');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'm1s-discovery-patch-'));
  try {
    const target = path.join(temporary, 'dist/lib/app'); fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ version: '2.1.0' }));
    const appFile = path.join(target, 'YouTubeApp.js'), sessionFile = path.join(target, 'Session.js');
    fs.writeFileSync(appFile, originalApp); fs.writeFileSync(sessionFile, originalSession);
    assert.equal(installDiscoveryIdentity(temporary), true); assert.equal(installDiscoveryIdentity(temporary), false);
    assert.equal(fs.readFileSync(appFile, 'utf8'), appSource); assert.equal(fs.readFileSync(sessionFile, 'utf8'), sessionSource);
    fs.writeFileSync(appFile, originalApp.replace('async stop(error)', 'async changedStop(error)'));
    fs.writeFileSync(sessionFile, originalSession);
    assert.throws(() => installDiscoveryIdentity(temporary), /refusing partial patch/);
    assert.equal(fs.readFileSync(sessionFile, 'utf8'), originalSession, 'App mismatch must not half-patch Session');
    fs.writeFileSync(appFile, originalApp); fs.writeFileSync(sessionFile, originalSession.replace('get client()', 'get changedClient()'));
    assert.throws(() => installDiscoveryIdentity(temporary), /refusing partial patch/);
    assert.equal(fs.readFileSync(appFile, 'utf8'), originalApp, 'Session mismatch must not half-patch App');
    fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ version: '2.1.1' }));
    assert.throws(() => installDiscoveryIdentity(temporary), /requires.*2\.1\.0/);
  } finally {
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log('PASS: actual App replies on the requesting client with real Session-restored MDX IDs; 0/10/20/30/40s bounded retries, ACK isolation, stale callbacks/SID restart/stop cleanup and failure safety; normal controls unchanged; no identity leaks; pinned atomic idempotent install.');
} finally {
  try { for (const session of realSessions) await session.end(); }
  finally {
    // Pinned Session.end leaves its old refresh timers alive. Scope cleanup to
    // this fixture instead of changing that unrelated production lifecycle.
    clearFixtureTimers();
    global.fetch = originalFetch; RPC.prototype.connect = originalConnect; RPC.prototype.disconnect = originalDisconnect;
  }
}
