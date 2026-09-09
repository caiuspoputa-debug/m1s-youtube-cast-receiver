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
