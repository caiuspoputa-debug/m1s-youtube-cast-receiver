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
