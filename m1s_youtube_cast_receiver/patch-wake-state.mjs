import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const marker = '// M1S guarded playback snapshot on registered sender wake';
const snapshotHelper = `${marker}
const m1sWakeMessageGuards = new WeakMap();
async function m1sReadWakePlaybackState(player) {
    const session = player.continuousSession;
    const generation = player.playGeneration;
    const videoId = player.currentVideoId;
    const ready = () => session === player.continuousSession && session?.active
        && generation === player.playGeneration && videoId && videoId === player.currentVideoId
        && player.queue.current?.id === videoId
        && player.ownsTarget && !player.sessionRelinquished
        && (player.startedAt !== null || player.paused)
        && [PLAYER_STATUSES.PLAYING, PLAYER_STATUSES.PAUSED].includes(player.status);
    if (!ready()) return null;
    try {
        const current = await player.getState();
        const isCurrent = () => ready()
            && [PLAYER_STATUSES.PLAYING, PLAYER_STATUSES.PAUSED].includes(current.status)
            && current.status === player.status && current.queue.current?.id === videoId;
        if (!isCurrent()) return null;
        return { current, isCurrent };
    } catch (_) {
        return null;
    }
}
function m1sQueueWakeMessages(sendMessages, snapshot, isActive, AID, navInfo) {
    const isCurrent = () => snapshot.isCurrent() && isActive();
    if (!isCurrent()) return;
    const current = snapshot.current;
    const messages = [new Message.NowPlaying(AID, current), new Message.OnStateChange(AID, current),
        new Message.OnHasPreviousNextChanged(AID, navInfo), new Message.OnVolumeChanged(AID, current.volume)];
    for (const message of messages) m1sWakeMessageGuards.set(message, isCurrent);
    sendMessages.push(...messages);
}
// M1S wake state helpers end
`;

export function patchWakeState(input, version) {
  if (version !== '2.1.0') throw new Error(`Wake state patch requires yt-cast-receiver 2.1.0; got ${version}`);
  let source = input.replace(/\r\n/g, '\n');
  const replaceOnce = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Wake state patch target mismatch: ${before.slice(0, 90)}`);
    source = source.replace(before, after);
  };
  const player = '__classPrivateFieldGet(this, _YouTubeApp_player, "f")';
  const active = '__classPrivateFieldGet(this, _YouTubeApp_activeSession, "f")';
  const messages = `new Message.NowPlaying(AID, m1sWakeState), new Message.OnStateChange(AID, m1sWakeState), new Message.OnHasPreviousNextChanged(AID, ${player}.getNavInfo())`;
  const queueWake = `m1sQueueWakeMessages(sendMessages, m1sWakeState, () => session === ${active}, AID, ${player}.getNavInfo());`;
  const originalSend = `    if (sendMessages.length > 0) {
        session.sendMessage(sendMessages)`;
  const guardedSend = `    const m1sCurrentMessages = sendMessages.filter(message => {
        const guard = m1sWakeMessageGuards.get(message);
        return !guard || guard();
    });
    if (m1sCurrentMessages.length > 0) {
        session.sendMessage(m1sCurrentMessages)`;

  if (source.includes(marker)) {
    const complete = /^\/\/ M1S guarded playback snapshot on registered sender wake\n[\s\S]*?\/\/ M1S wake state helpers end\n/m;
    const legacy = /^\/\/ M1S guarded playback snapshot on registered sender wake\nasync function m1sReadWakePlaybackState\([\s\S]*?\n}\n/m;
    const pattern = source.includes('// M1S wake state helpers end') ? complete : legacy;
    if (source.split(marker).length !== 2 || !pattern.test(source)) throw new Error('Wake state helper target mismatch');
    source = source.replace(pattern, snapshotHelper);
    // Upgrade an already-installed initial wake patch without stacking wrappers.
    source = source.replaceAll(`sendMessages.push(${messages});`, queueWake);
    if (source.includes(originalSend)) replaceOnce(originalSend, guardedSend);
    if (!source.includes(guardedSend) || source.split(queueWake).length !== 3) throw new Error('Wake state final guard target mismatch');
    return source;
  }

  const duplicate = `        __classPrivateFieldGet(this, _YouTubeApp_logger, "f").debug(\`[yt-cast-receiver] (\${client.name}) Sender already connected.\`);`;
  replaceOnce(duplicate, `${duplicate}
        const m1sWakeState = await m1sReadWakePlaybackState(${player});
        if (m1sWakeState && session === ${active}) {
            ${queueWake}
        }`);

  const lounge = `                    sendMessages.push(new Message.OnHasPreviousNextChanged(AID, playerNavInfo), new Message.OnAutoplayModeChanged(AID, playerNavInfo));`;
  replaceOnce(lounge, `${lounge}
                    const m1sRegisteredWake = session === ${active}
                        && loungeStatusSenders.some(sender => __classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f").some(known => known.id === sender.id));
                    if (m1sRegisteredWake) {
                        const m1sWakeState = await m1sReadWakePlaybackState(${player});
                        if (m1sWakeState && session === ${active}) {
                            ${queueWake}
                        }
                    }`);
  replaceOnce(originalSend, guardedSend);
  return snapshotHelper + source;
}

export function installWakeState() {
  const dependency = new URL('./node_modules/yt-cast-receiver/', import.meta.url);
  const packageInfo = JSON.parse(fs.readFileSync(new URL('package.json', dependency), 'utf8'));
  const app = new URL('dist/lib/app/YouTubeApp.js', dependency);
  const source = fs.readFileSync(app, 'utf8');
  const patched = patchWakeState(source, packageInfo.version);
  if (patched !== source) fs.writeFileSync(app, patched);
  console.log('M1S: guarded current-track snapshots enabled for registered sender wake.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) installWakeState();
