import assert from 'node:assert/strict';
import fs from 'node:fs';
import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import * as Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
import Player from '../node_modules/yt-cast-receiver/dist/lib/Player.js';
import Message from '../node_modules/yt-cast-receiver/dist/lib/app/Message.js';
import Sender from '../node_modules/yt-cast-receiver/dist/lib/app/Sender.js';
import { AppError, SenderConnectionError, IncompleteAPIDataError } from '../node_modules/yt-cast-receiver/dist/lib/utils/Errors.js';
import { patchControlTrace } from '../patch-controls.mjs';

const appSource = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js', import.meta.url), 'utf8');
const patched = patchControlTrace(appSource, '2.1.0');
assert.equal(patchControlTrace(patched, '2.1.0'), patched, 'patch must be idempotent');
const laterMarker = '// A later dependency patch may prepend its own marker\n';
assert.equal(patchControlTrace(laterMarker + patched, '2.1.0'), laterMarker + patched);
assert.equal(patched.split('// M1S control lifecycle trace v3').length - 1, 1);
const presenceHelper = patched.match(/^function m1sTraceSenderPresence\([\s\S]*?^}\n/m)?.[0];
const presenceStart = patched.indexOf('            try {\n                m1sTraceSenderPresence(');
const presenceEnd = patched.indexOf('            if (this.state === STATUSES.STARTING)', presenceStart);
assert.ok(presenceHelper && presenceStart >= 0 && presenceEnd > presenceStart);
const presenceCall = patched.slice(presenceStart, presenceEnd);
const version2 = patched.replace(presenceHelper, '').replace(presenceCall, '')
  .replace('// M1S control lifecycle trace v3', '// M1S control lifecycle trace v2');
assert.equal(patchControlTrace(version2, '2.1.0'), patched, 'installed v2 must upgrade without duplicating prior traces');
assert.equal(patchControlTrace(laterMarker + version2, '2.1.0'), laterMarker + patched);
assert.throws(() => patchControlTrace(patched.replace(presenceCall, ''), '2.1.0'), /target mismatch/);
assert.throws(() => patchControlTrace(version2.replace('            if (this.state === STATUSES.STARTING)', '            if (false)'), '2.1.0'), /target mismatch/);
assert.throws(() => patchControlTrace(appSource, '2.2.0'), /requires.*2\.1\.0/);
assert.throws(() => patchControlTrace('export default class Unknown {}', '2.1.0'), /target mismatch/);
new Function(patched.replace(/^import .*;\r?\n/gm, '').replace('export default YouTubeApp;', ''));

const traces = [], errors = [], sessions = [];
const logger = { debug() {}, info: (...args) => traces.push(args.join(' ')), warn() {}, error: (...args) => errors.push(args) };
class NetworkSession extends EventEmitter {
  constructor(options) { super(); this.client = options.client; this.sent = []; this.pairings = 0; this.ended = 0; sessions.push(this); }
  async begin() {}
  async end() { this.ended++; }
  async registerPairingCode() { this.pairings++; }
  async sendMessage(message) { this.sent.push(...(Array.isArray(message) ? message : [message])); }
}
class QueueHandler {
  setLogger() {}
  reset() {}
  async getPreviousNextVideosAbortable(target, queue) {
    const index = queue.videoIds.indexOf(target.id);
    const at = value => value >= 0 && value < queue.videoIds.length
      ? { id: queue.videoIds[value], client: target.client, context: { ...target.context, index: value } }
      : null;
    return { previous: at(index - 1), next: at(index + 1) };
  }
}
class TestPlayer extends Player {
  constructor() { super(); this.definition = { name: 'Trace receiver' }; this.resets = 0; this.position = 0; }
  async reset(...args) { this.resets++; return super.reset(...args); }
  async doPlay(video, position) { this.position = position; return true; }
  async doStop() { return true; }
  async doPause() { return true; }
  async doResume() { return true; }
  async doSeek(position) { this.position = position; return true; }
  async doGetPosition() { return this.position; }
  async doGetDuration() { return 120; }
  async doGetVolume() { return { level: 5, muted: false }; }
  async doSetVolume() { return true; }
}
const dependencies = { EventEmitter, queryString: { parse: value => Object.fromEntries(new URLSearchParams(value)) },
  uuidv4: randomUUID, Message, Session: NetworkSession, Sender,
  AppError, SenderConnectionError, IncompleteAPIDataError, ...Constants, DefaultPlaylistRequestHandler: QueueHandler };
delete dependencies.default;
const code = patched.replace(/^import .*;\r?\n/gm, '').replace('export default YouTubeApp;', '');
const api = new Function(...Object.keys(dependencies), `${code}
return {
  App: YouTubeApp,
  trace: m1sTraceCastControl,
  presence: m1sTraceSenderPresence,
  incoming: (app, message, session) => _YouTubeApp_handleIncomingMessage.call(app, message, session),
  connected: (app, sender, session) => _YouTubeApp_handleSenderConnected.call(app, sender, session),
  disconnected: (app, sender, session, implicit) => _YouTubeApp_handleSenderDisconnected.call(app, sender, session, implicit)
};`)(...Object.values(dependencies));
const player = new TestPlayer();
assert.doesNotThrow(() => api.trace({ info() { throw new Error('logger unavailable'); } }, player, 'incoming', {}));
const app = new api.App(player, { logger, screenName: 'Trace receiver', enableAutoplayOnConnect: false,
  playlistRequestHandler: new QueueHandler(), mutePolicy: Constants.MUTE_POLICIES.PRESERVE_VOLUME_LEVEL,
  resetPlayerOnDisconnectPolicy: Constants.RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_EXPLICITLY_DISCONNECTED });
const [yt, ytm] = sessions;
await app.start();
await app.launch('pairingCode=pairing-secret&theme=cl');
await app.launch('pairingCode=another-pairing-secret&theme=cl');
assert.equal(player.resets, 0, 'same-theme DIAL launch must preserve existing behavior');
assert.equal(yt.sent.some(message => message instanceof Message.LoungeScreenDisconnected), false);
assert.equal(traces.filter(line => line.includes('event=dial_launch')).length, 2);

let AID = 0;
const incoming = (name, payload = {}, session = yt) => api.incoming(app, new Message(++AID, name, payload), session);
const secrets = { ctt: 'ctt-private-secret', cpn: 'cpn-private-secret',
  url: 'https://private.test/audio?token=url-private-secret', pairingCode: 'pairing-payload-secret' };
await incoming('setPlaylist', { videoIds: 'AAAAAAAAAAA,BBBBBBBBBBB,CCCCCCCCCCC', videoId: 'AAAAAAAAAAA',
  listId: 'safe-list', currentIndex: '0', currentTime: '0',
  eventDetails: JSON.stringify({ eventType: 'PLAYLIST_SET', videoId: 'AAAAAAAAAAA', user: 'private-user-secret' }), ...secrets });
assert.equal(player.queue.current.id, 'AAAAAAAAAAA');
const selectedQueue = traces.find(line => line.includes('event=queue_updated') && line.includes('command=setPlaylist'));
assert.ok(selectedQueue?.includes('eventType=PLAYLIST_SET eventVideoId=AAAAAAAAAAA videoIdsCount=3 selectedInVideoIds=true'));
assert.ok(selectedQueue.includes('currentVideoId=AAAAAAAAAAA nextVideoId=BBBBBBBBBBB'));
assert.ok(selectedQueue.includes('queueLength=3 queueUpdating=false'));
assert.ok(selectedQueue.includes('hasNext=true'));
await incoming('next');
assert.equal(player.queue.current.id, 'BBBBBBBBBBB');
await incoming('seekTo', { newTime: '10' });
assert.equal(player.position, 10);
await incoming('pause'); await incoming('play'); await incoming('previous');
await incoming('updatePlaylist', { videoIds: 'AAAAAAAAAAA,BBBBBBBBBBB', listId: 'safe-list' });
await incoming('stopVideo');
const beforeNoop = traces.filter(line => line.includes('[M1S-CAST]')).length;
await incoming('noop'); await incoming('getNowPlaying');
assert.equal(traces.filter(line => line.includes('[M1S-CAST]')).length, beforeNoop, 'periodic/noop events must remain quiet');
for (const command of ['setPlaylist', 'updatePlaylist', 'play', 'pause', 'stopVideo', 'next', 'previous', 'seekTo']) {
  assert.ok(traces.some(line => line.includes('event=incoming') && line.includes(`command=${command} `)), command);
}
assert.ok(traces.some(line => line.includes('currentIndex=0 currentIndexType=string')));
assert.ok(traces.some(line => line.includes('command=seekTo') && line.includes('currentTime=10')));
const semantic = traces.filter(line => line.includes('[M1S-CAST]'));
for (const secret of Object.values(secrets).concat(['pairing-secret', 'another-pairing-secret', 'private-user-secret'])) {
  assert.ok(!semantic.some(line => line.includes(secret)), `trace must exclude ${secret}`);
}

const sender = Sender.parse({ id: 'safe-sender', name: 'Tablet', theme: 'cl', capabilities: '' });
await api.connected(app, sender, yt);
const senderData = { id: 'safe-sender', name: 'Tablet', theme: 'cl', type: 'REMOTE_CONTROL' };
const presencePayload = {
  devices: JSON.stringify([senderData, { id: 'private-screen-id', type: 'LOUNGE_SCREEN', user: 'private-screen-user' }]),
  connectionEventDetails: JSON.stringify({ deviceId: sender.id, ui: 'true',
    disconnectBehavior: 'MDX_SESSION_DISCONNECT_BEHAVIOR_DISCONNECTED_BY_USER', ...secrets })
};
const originalPresencePayload = structuredClone(presencePayload);
const beforePresence = player.resets;
await incoming('loungeStatus', presencePayload);
assert.deepEqual(presencePayload, originalPresencePayload, 'diagnostics must not mutate the original protocol fields');
assert.equal(player.resets, beforePresence, 'a present known sender remains connected');
const presence = traces.filter(line => line.includes('event=sender_presence')).at(-1);
assert.ok(presence.includes('clientKey=YT activeClientKey=YT state=running'));
assert.ok(presence.includes('totalDevices=2 nonScreenDevices=1 remoteControlDevices=1 parsedSenders=1 registeredSenders=1'));
assert.ok(presence.includes('changedKnown=true changedInRaw=true changedInParsed=true ui=true uiType=string'));
assert.ok(presence.includes('disconnectBehavior=MDX_SESSION_DISCONNECT_BEHAVIOR_DISCONNECTED_BY_USER'));
assert.ok(!presence.includes(sender.id) && !presence.includes('private-screen'));
const beforeImplicit = player.resets;
await api.disconnected(app, sender, yt, true);
assert.equal(player.resets, beforeImplicit, 'implicit disconnect policy unchanged');
await api.connected(app, sender, yt);
await api.disconnected(app, sender, yt, false);
assert.equal(player.resets, beforeImplicit + 1, 'last explicit disconnect still resets as configured');
await api.disconnected(app, sender, ytm, false);
assert.ok(traces.some(line => line.includes('event=sender_disconnect') && line.includes('kind=implicit active=true')));
assert.ok(traces.some(line => line.includes('event=sender_disconnect') && line.includes('kind=explicit active=false')));
assert.ok(traces.some(line => line.includes('event=player_reset') && line.includes('reason=all_senders_disconnected')));

// The added trace must expose the original parser decision without fixing or
// reinterpreting it: boolean true is implicit; missing type is excluded from
// the existing REMOTE_CONTROL-only list even when the raw known ID is present.
await api.connected(app, sender, yt);
const beforeBooleanUi = player.resets;
await incoming('loungeStatus', { devices: '[]',
  connectionEventDetails: JSON.stringify({ deviceId: sender.id, ui: true }) });
assert.equal(player.resets, beforeBooleanUi, 'boolean ui must retain the existing implicit-disconnect policy');
assert.ok(traces.filter(line => line.includes('event=sender_presence')).at(-1).includes('ui=true uiType=boolean'));
await api.connected(app, sender, yt);
const beforeMissingType = player.resets;
const info = logger.info;
logger.info = (...args) => {
  if (String(args[0]).includes('event=sender_presence')) throw new Error('trace sink unavailable');
  info(...args);
};
try {
  const { type, ...typeless } = senderData;
  await incoming('loungeStatus', { devices: JSON.stringify([typeless]),
    connectionEventDetails: JSON.stringify({ deviceId: sender.id, ui: 'true' }) });
} finally { logger.info = info; }
assert.equal(player.resets, beforeMissingType + 1, 'failing diagnostics cannot change the original explicit/reset outcome');
await api.connected(app, sender, yt);
const { type, ...typeless } = senderData;
await incoming('loungeStatus', { devices: JSON.stringify([typeless]),
  connectionEventDetails: JSON.stringify({ deviceId: sender.id, ui: 'true' }) });
const excluded = traces.filter(line => line.includes('event=sender_presence')).at(-1);
assert.ok(excluded.includes('totalDevices=1 nonScreenDevices=1 remoteControlDevices=0 parsedSenders=0 registeredSenders=1'));
assert.ok(excluded.includes('changedKnown=true changedInRaw=true changedInParsed=false'));

api.presence(logger, player, { connectionEventDetails: JSON.stringify({ deviceId: 'private-device-secret',
  ui: 'private-ui-secret', disconnectBehavior: 'https://private.test/?token=disconnect-secret', ...secrets }) },
  [{ id: 'private-device-secret', user: 'private-device-user', type: 'REMOTE_CONTROL' }],
  [{ id: 'private-device-secret' }], [{ id: 'private-device-secret' }], 700, 'YT', 'YT', 'running');
const redactedPresence = traces.at(-1);
assert.ok(redactedPresence.includes('ui=<invalid> uiType=string disconnectBehavior=<invalid>'));
assert.ok(!redactedPresence.includes('secret') && !redactedPresence.includes('private-device'));
api.presence(logger, player, { connectionEventDetails: JSON.stringify({ ui: false,
  disconnectBehavior: 'MDX_SESSION_DISCONNECT_BEHAVIOR_PRIVATE_DEVICE_SECRET' }) }, [], [], [], 704, 'YT', 'YT', 'running');
assert.ok(traces.at(-1).includes('ui=false uiType=boolean disconnectBehavior=<invalid>'));
assert.ok(!traces.at(-1).includes('PRIVATE_DEVICE_SECRET'), 'only the public reason enum may be logged');
assert.doesNotThrow(() => api.presence(logger, player, { connectionEventDetails: '{invalid json' }, null, null, null, 701, 'YT', 'YT', 'running'));
assert.ok(traces.at(-1).includes('totalDevices=<missing>'));
assert.ok(traces.at(-1).includes('ui=<missing> uiType=undefined disconnectBehavior=<missing>'));
assert.doesNotThrow(() => api.presence(logger, player, {
  get connectionEventDetails() { throw new Error('unreadable details'); }
}, [], [], [], 702, 'YT', 'YT', 'running'));
assert.doesNotThrow(() => api.presence({ info() { throw new Error('unavailable logger'); } }, player,
  {}, [], [], [], 703, 'YT', 'YT', 'running'));

const beforeSwitch = player.resets;
await app.launch('pairingCode=music-pairing-secret&theme=m');
assert.equal(player.resets, beforeSwitch + 1);
assert.ok(yt.sent.some(message => message instanceof Message.LoungeScreenDisconnected));
assert.ok(traces.some(line => line.includes('event=active_session_switch') && line.includes('fromClientKey=YT toClientKey=YTMUSIC')));

// Even malformed scalar fields are redacted, while numeric index zero remains
// distinguishable from the string zero through the actual incoming handler.
await incoming('setPlaylist', { videoId: 'https://private.test/?token=bad-video-secret',
  listId: { token: 'bad-list-secret' }, currentIndex: 0,
  currentTime: 'https://private.test/?token=bad-time-secret' }, yt);
const invalid = traces.filter(line => line.includes('event=incoming')).at(-1);
assert.ok(invalid.includes('allowed=false'));
assert.ok(invalid.includes('videoId=<invalid> listId=<non-scalar> currentIndex=0 currentIndexType=number currentTime=<invalid>'));
assert.ok(!invalid.includes('secret'));
assert.doesNotThrow(() => api.trace(logger, player, 'malformed', {
  eventVideoId: 'https://private.test/?token=event-video-secret', nextVideoId: 'invalid-video-secret',
  autoplayVideoId: 'https://private.test/?token=autoplay-secret'
}));
assert.ok(traces.at(-1).includes('eventVideoId=<invalid> nextVideoId=<invalid> autoplayVideoId=<invalid>'));

const failure = new Error('https://private.test/?token=error-message-secret');
failure.name = 'RPCError';
yt.emit('terminate', failure);
for (let i = 0; i < 100 && app.state !== Constants.STATUSES.STOPPED; i++) await new Promise(resolve => setImmediate(resolve));
assert.equal(app.state, Constants.STATUSES.STOPPED);
assert.ok(traces.some(line => line.includes('event=session_terminated') && line.includes('clientKey=YT activeClientKey=YTMUSIC errorName=RPCError')));
assert.ok(traces.some(line => line.includes('event=app_stop') && line.includes('reason=session_error')));
assert.ok(traces.filter(line => line.includes('[M1S-CAST]')).every(line => !line.includes('error-message-secret')));
assert.deepEqual(errors, []);

console.log('PASS: idempotent pinned control INFO tracing exercises actual YouTubeApp and Player paths, preserves same/different-theme and disconnect semantics, excludes secrets and remains quiet for periodic messages.');
