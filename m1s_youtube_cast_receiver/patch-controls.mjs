import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const marker = '// M1S control lifecycle trace v1';
const helper = `${marker}
function m1sTraceCastControl(logger, player, event, fields) {
    try {
    const scalar = (value, key) => {
        if (value === undefined) return '<missing>';
        if (value === null) return 'null';
        if (!['string', 'number', 'boolean'].includes(typeof value)) return '<non-scalar>';
        const text = String(value).replace(/[\\u0000-\\u001f\\u007f]/g, ' ');
        if (/https?:\\/\\//i.test(text)) return '<invalid>';
        if (key === 'videoId' && !/^[A-Za-z0-9_-]{11}$/.test(text)) return '<invalid>';
        if (key === 'listId' && !/^[A-Za-z0-9_-]{1,160}$/.test(text)) return '<invalid>';
        if (['AID', 'currentIndex', 'currentTime'].includes(key)
            && (text.trim() === '' || !Number.isFinite(Number(text)))) return '<invalid>';
        return text.slice(0, 160);
    };
    const receiver = scalar(player?.definition?.name || 'receiver');
    const detail = Object.entries(fields).map(([key, value]) => key + '=' + scalar(value, key)).join(' ');
    logger.info('[M1S-CAST] [' + receiver + '] event=' + event + ' ' + detail);
    } catch (_) {
        // Diagnostics must never change a control or session decision.
    }
}
`;

/** Add diagnostics to pinned control paths without changing their decisions. */
export function patchControlTrace(input, version) {
  if (version !== '2.1.0') throw new Error(`Cast control trace requires yt-cast-receiver 2.1.0; got ${version}`);
  let source = input.replace(/\r\n/g, '\n');
  if (source.includes(marker)) {
    const pattern = /^\/\/ M1S control lifecycle trace v1\nfunction m1sTraceCastControl\([\s\S]*?\n}\n/m;
    if (source.split(marker).length !== 2 || !pattern.test(source)) throw new Error('Cast control trace helper target mismatch');
    return source.replace(pattern, helper);
  }
  const replaceOnce = (needle, replacement) => {
    if (source.split(needle).length !== 2) throw new Error(`Cast control trace target mismatch: ${needle.slice(0, 90)}`);
    source = source.replace(needle, replacement);
  };
  const player = '__classPrivateFieldGet(this, _YouTubeApp_player, "f")';
  const logger = '__classPrivateFieldGet(this, _YouTubeApp_logger, "f")';
  const active = '__classPrivateFieldGet(this, _YouTubeApp_activeSession, "f")';
  const trace = (event, fields) => `m1sTraceCastControl(${logger}, ${player}, '${event}', { ${fields} });`;

  const incoming = '    const sendMessages = [];\n    switch (name) {';
  replaceOnce(incoming, `    if (['setPlaylist', 'updatePlaylist', 'play', 'pause', 'stopVideo', 'next', 'previous', 'seekTo'].includes(name)) {
        ${trace('incoming', "command: name, AID, clientKey: client?.key, activeClientKey: " + active + "?.client?.key, allowed: m1sCanControl, videoId: payload?.videoId, listId: payload?.listId, currentIndex: payload?.currentIndex, currentIndexType: typeof payload?.currentIndex, currentTime: name === 'seekTo' ? payload?.newTime : payload?.currentTime")}
    }
${incoming}`);

  const launch = '        if (pairingCode && session) {';
  replaceOnce(launch, `        ${trace('dial_launch', `theme, clientKey: session?.client?.key, activeClientKey: ${active}?.client?.key`)}
${launch}`);

  const sessionError = '                    // Session terminated. So should YouTubeApp.';
  replaceOnce(sessionError, `                    ${trace('session_terminated', `clientKey: session.client?.key, activeClientKey: ${active}?.client?.key, errorName: error?.name || 'Error'`)}
${sessionError}`);

  const stopping = "        this.state = STATUSES.STOPPING;";
  replaceOnce(stopping, `        ${trace('app_stop', `reason: error ? 'session_error' : 'app_stop', activeClientKey: ${active}?.client?.key, errorName: error?.name`)}
${stopping}`);

  const switchReset = `        await ${player}.reset();\n        __classPrivateFieldSet(this, _YouTubeApp_connectedSenders, [], "f");`;
  replaceOnce(switchReset, `        ${trace('active_session_switch', `reason: 'client_theme_change', fromClientKey: ${active}?.client?.key, toClientKey: targetSession.client?.key`)}
${switchReset}`);

  const disconnect = `    if (!isSessionActive)\n        return [];\n    const client = session.client;`;
  replaceOnce(disconnect, `    ${trace('sender_disconnect', `clientKey: session.client?.key, activeClientKey: ${active}?.client?.key, kind: implicit ? 'implicit' : 'explicit', active: isSessionActive`)}
${disconnect}`);

  const disconnectReset = `            await ${player}.reset();\n        }\n    }\n    else if (`;
  replaceOnce(disconnectReset, `            ${trace('player_reset', `reason: 'all_senders_disconnected', clientKey: client?.key, kind: implicit ? 'implicit' : 'explicit'`)}
${disconnectReset}`);

  return helper + source;
}

export function installControlTrace() {
  const dependency = new URL('./node_modules/yt-cast-receiver/', import.meta.url);
  const packageInfo = JSON.parse(fs.readFileSync(new URL('package.json', dependency), 'utf8'));
  const app = new URL('dist/lib/app/YouTubeApp.js', dependency);
  const source = fs.readFileSync(app, 'utf8');
  const patched = patchControlTrace(source, packageInfo.version);
  if (patched !== source) fs.writeFileSync(app, patched);
  console.log('M1S: semantic Cast control and session lifecycle INFO tracing enabled.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) installControlTrace();
