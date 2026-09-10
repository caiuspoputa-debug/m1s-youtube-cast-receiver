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

const sidecarMarker = '// M1S 1.0.10 YTM sidecar state/control bridge';
source = fs.readFileSync(app, 'utf8').replace(/\r\n/g, '\n');
if (!source.includes(sidecarMarker)) {
  // IMPORTANT: keep the active session unchanged. In live YTM traffic the actual
  // setPlaylist/play messages may still arrive through the generic YT lounge
  // session. 1.0.8 promoted YTM to active and therefore caused those YT messages
  // to hit `if (!isSessionActive) return`, so playback never started.

  const incomingStart = source.indexOf('_YouTubeApp_handleIncomingMessage = async function _YouTubeApp_handleIncomingMessage');
  const incomingEnd = source.indexOf('}, _YouTubeApp_handleSenderConnected = async function _YouTubeApp_handleSenderConnected', incomingStart);
  if (incomingStart < 0 || incomingEnd < 0) throw Error('YTM 1.0.10 incoming-message function target missing');
  let incoming = source.slice(incomingStart, incomingEnd);

  const dispatchNeedle = `    if (isSessionActive && ['setPlaylist', 'play', 'pause', 'stop', 'seekTo', 'next', 'previous'].includes(name)) {`;
  if (incoming.split(dispatchNeedle).length !== 2) throw Error('YTM 1.0.10 dispatch target mismatch');
  incoming = incoming.replace(dispatchNeedle, `    const m1sYtmSidecar = !isSessionActive && client?.key === 'YTMUSIC'
        && isMusicSender(__classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f"), client);
    const m1sCanControl = isSessionActive || m1sYtmSidecar;
    if (m1sCanControl && ['setPlaylist', 'play', 'pause', 'stop', 'seekTo', 'next', 'previous'].includes(name)) {`);

  const activeGuard = /if \(!isSessionActive\)\s*return;/g;
  const guardCount = (incoming.match(activeGuard) || []).length;
  if (guardCount < 8 || guardCount > 10) throw Error(`YTM 1.0.10 unexpected active-control guard count: ${guardCount}`);
  incoming = incoming.replace(activeGuard, 'if (!m1sCanControl) return;');

  const nowPlayingOld = 'isSessionActive ? await __classPrivateFieldGet(this, _YouTubeApp_player, "f").getState() : null';
  if (incoming.split(nowPlayingOld).length !== 2) throw Error('YTM 1.0.10 getNowPlaying target mismatch');
  incoming = incoming.replace(nowPlayingOld, 'm1sCanControl ? await __classPrivateFieldGet(this, _YouTubeApp_player, "f").getState() : null');

  const navOld = 'const playerNavInfo = isSessionActive ? __classPrivateFieldGet(this, _YouTubeApp_player, "f").getNavInfo() : null;';
  if (incoming.split(navOld).length !== 2) throw Error('YTM 1.0.10 lounge navigation target mismatch');
  incoming = incoming.replace(navOld, 'const playerNavInfo = m1sCanControl ? __classPrivateFieldGet(this, _YouTubeApp_player, "f").getNavInfo() : null;');

  source = source.slice(0, incomingStart) + incoming + source.slice(incomingEnd);

  // Mirror state to the YTM sidecar without changing `activeSession`. This is
  // what the YTM phone UI needs for time / Pause / Previous / Next, while the
  // working YT lounge path remains the owner of initial playback.
  const stateStart = source.indexOf('_YouTubeApp_handlePlayerStateEvent = function _YouTubeApp_handlePlayerStateEvent');
  const stateEnd = source.indexOf('\n};\nexport default YouTubeApp;', stateStart);
  if (stateStart < 0 || stateEnd < 0) throw Error('YTM 1.0.10 state-event function target missing');
  let state = source.slice(stateStart, stateEnd);
  const activeSend = '__classPrivateFieldGet(this, _YouTubeApp_activeSession, "f").sendMessage(messages';
  const sendCount = state.split(activeSend).length - 1;
  if (sendCount !== 2) throw Error(`YTM 1.0.10 expected two active state sends, got ${sendCount}`);
  const mirror = `const m1sYtmStateSession = __classPrivateFieldGet(this, _YouTubeApp_sessions, "f").YTMUSIC;
        const m1sActiveStateSession = __classPrivateFieldGet(this, _YouTubeApp_activeSession, "f");
        if (__classPrivateFieldGet(this, _YouTubeApp_player, "f").musicSenderActive
            && m1sYtmStateSession && m1sYtmStateSession !== m1sActiveStateSession) {
            m1sYtmStateSession.sendMessage(messages)
                .catch((error) => __classPrivateFieldGet(this, _YouTubeApp_logger, "f").debug('[M1S-YT] YTM sidecar state mirror failed:', error?.message || error));
        }
        `;
  state = state.replaceAll(activeSend, mirror + activeSend);
  source = source.slice(0, stateStart) + state + source.slice(stateEnd);

  fs.writeFileSync(app, sidecarMarker + '\n' + source);
}
console.log('M1S 1.0.10: YTM sidecar state/control bridge applied; active playback session left unchanged.');
