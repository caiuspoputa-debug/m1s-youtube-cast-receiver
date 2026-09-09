import fs from 'node:fs';
import { isMusicSender } from './music-start.mjs';
const app = new URL('./node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js', import.meta.url);
const marker = '// M1S 1.0.6 YTM-only startup dispatch';
let source = fs.readFileSync(app, 'utf8').replace(/\r\n/g, '\n');
if (!source.includes(marker)) {
  const needle = '    const isSessionActive = session === __classPrivateFieldGet(this, _YouTubeApp_activeSession, "f");\n    const client = session.client;';
  if (source.split(needle).length !== 2) throw Error('YTM dispatch patch target mismatch');
  source = source.replace(needle, needle + `
    if (isSessionActive && ['setPlaylist', 'play', 'pause', 'stop', 'seekTo', 'next', 'previous'].includes(name)) {
        __classPrivateFieldGet(this, _YouTubeApp_player, "f").musicSenderActive = isMusicSender(
            __classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f"), client);
    }`);
  fs.writeFileSync(app, marker + '\n' + isMusicSender.toString() + '\n' + source);
}
console.log('M1S 1.0.6: startup guard restricted to identified YouTube Music senders.');
const registrationMarker = '// M1S 1.0.7 register initial music senders';
source = fs.readFileSync(app,'utf8');
if (!source.includes(registrationMarker)) {
  const needle = '    const client = session.client;\n    if (isSessionActive';
  if (source.split(needle).length !== 2) throw Error('YTM sender registration patch target mismatch');
  source = source.replace(needle, `    const client = session.client;
    ${registrationMarker}
    if (isSessionActive && isMusicSender(__classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f"), client)) {
        const musicPlayer = __classPrivateFieldGet(this, _YouTubeApp_player, "f");
        musicPlayer.musicSenderActive = true;
        for (const sender of __classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f")) {
            if (sender.id && !musicPlayer.connectedSenderIds.has(sender.id)) musicPlayer.noteSenderConnected(sender);
        }
    }
    if (isSessionActive`);
  fs.writeFileSync(app,source);
}
console.log('M1S 1.0.7: initial YTM senders registered for state publication.');

const activeSessionMarker = '// M1S 1.0.8 YTM active-session routing';
source = fs.readFileSync(app, 'utf8').replace(/\r\n/g, '\n');
if (!source.includes(activeSessionMarker)) {
  // 1) During startup, the first loungeStatus can arrive on the generic YouTube
  // transport even when every connected sender identifies itself as YTMUSIC.
  // Route only that all-YTM case to the YTM session; normal YouTube stays exactly
  // on the library's original path.
  const startupBefore = `                    __classPrivateFieldSet(this, _YouTubeApp_activeSession, session, "f");\n                    __classPrivateFieldGet(this, _YouTubeApp_logger, "f").debug(\`[yt-cast-receiver] Active session switched to '\${client.name}'.\`);`;
  const startupAfter = `                    const m1sTargetSession = isMusicSender(loungeStatusSenders, client)\n                        ? __classPrivateFieldGet(this, _YouTubeApp_sessions, "f").YTMUSIC\n                        : session;\n                    __classPrivateFieldSet(this, _YouTubeApp_activeSession, m1sTargetSession, "f");\n                    __classPrivateFieldGet(this, _YouTubeApp_logger, "f").debug(\`[yt-cast-receiver] Active session switched to '\${m1sTargetSession.client.name}'.\`);`;
  if (source.split(startupBefore).length !== 2) throw Error('YTM startup active-session patch target mismatch');
  source = source.replace(startupBefore, startupAfter);

  // 2) A YTM sender can be reported by the generic YT lounge session. Do not call
  // checkAndSwitchActiveSession(YT) for that sender because it can reset playback.
  // Promote the already-running YTM session directly and leave the YT branch intact.
  const connectBefore = `}, _YouTubeApp_handleSenderConnected = async function _YouTubeApp_handleSenderConnected(sender, session, AID) {\n    await __classPrivateFieldGet(this, _YouTubeApp_instances, "m", _YouTubeApp_checkAndSwitchActiveSession).call(this, session);\n    const sendMessages = [];`;
  const connectAfter = `}, _YouTubeApp_handleSenderConnected = async function _YouTubeApp_handleSenderConnected(sender, session, AID) {\n    if (sender?.client?.key === 'YTMUSIC') {\n        const ytmSession = __classPrivateFieldGet(this, _YouTubeApp_sessions, "f").YTMUSIC;\n        if (__classPrivateFieldGet(this, _YouTubeApp_activeSession, "f") !== ytmSession) {\n            __classPrivateFieldSet(this, _YouTubeApp_activeSession, ytmSession, "f");\n            __classPrivateFieldGet(this, _YouTubeApp_logger, "f").debug('[M1S-YT] YTM sender routed to YouTube Music control session without resetting playback.');\n        }\n    }\n    else {\n        await __classPrivateFieldGet(this, _YouTubeApp_instances, "m", _YouTubeApp_checkAndSwitchActiveSession).call(this, session);\n    }\n    const sendMessages = [];`;
  if (source.split(connectBefore).length !== 2) throw Error('YTM sender-connect routing patch target mismatch');
  source = source.replace(connectBefore, connectAfter);

  // 3) Race fallback: if YTM is already connected but the generic YT session won
  // startup, the periodic YTM noop is enough to repair ownership. This changes only
  // an all-YTM sender set and does not run for ordinary YouTube senders.
  const incomingBefore = `    const { AID, name, payload } = message;\n    const isSessionActive = session === __classPrivateFieldGet(this, _YouTubeApp_activeSession, "f");\n    const client = session.client;`;
  const incomingAfter = `    const { AID, name, payload } = message;\n    const client = session.client;\n    if (client?.key === 'YTMUSIC' && __classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f").length > 0\n        && isMusicSender(__classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f"), client)\n        && session !== __classPrivateFieldGet(this, _YouTubeApp_activeSession, "f")) {\n        __classPrivateFieldSet(this, _YouTubeApp_activeSession, session, "f");\n        const musicPlayer = __classPrivateFieldGet(this, _YouTubeApp_player, "f");\n        musicPlayer.musicSenderActive = true;\n        for (const sender of __classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f")) {\n            if (sender.id && !musicPlayer.connectedSenderIds.has(sender.id)) musicPlayer.noteSenderConnected(sender);\n        }\n        __classPrivateFieldGet(this, _YouTubeApp_logger, "f").debug('[M1S-YT] YTM control session promoted from sidecar traffic; playback was not reset.');\n    }\n    const isSessionActive = session === __classPrivateFieldGet(this, _YouTubeApp_activeSession, "f");`;
  if (source.split(incomingBefore).length !== 2) throw Error('YTM incoming-session promotion patch target mismatch');
  source = source.replace(incomingBefore, incomingAfter);

  fs.writeFileSync(app, activeSessionMarker + '\n' + source);
}
console.log('M1S 1.0.8: YTM sender/state is routed to the YouTube Music session; normal YouTube path unchanged.');
