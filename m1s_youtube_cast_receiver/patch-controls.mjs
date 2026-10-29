import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const oldMarker = '// M1S control lifecycle trace v1';
const previousMarker = '// M1S control lifecycle trace v2';
const marker = '// M1S control lifecycle trace v3';
const helper = `${marker}
function m1sTraceCastControl(logger, player, event, fields) {
    try {
    const scalar = (value, key) => {
        if (value === undefined) return '<missing>';
        if (value === null) return 'null';
        if (!['string', 'number', 'boolean'].includes(typeof value)) return '<non-scalar>';
        const text = String(value).replace(/[\\u0000-\\u001f\\u007f]/g, ' ');
        if (/https?:\\/\\//i.test(text)) return '<invalid>';
        if (/videoId$/i.test(key) && !/^[A-Za-z0-9_-]{11}$/.test(text)) return '<invalid>';
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
function m1sTracePlaylistFields(payload, player) {
    try {
        let event = payload?.eventDetails;
        if (typeof event === 'string') {
            try { event = JSON.parse(event); } catch (_) { event = null; }
        }
        const ids = typeof payload?.videoIds === 'string' ? payload.videoIds.split(',').filter(Boolean) : null;
        const selected = event?.eventType === 'VIDEO_SELECTED' ? event?.videoId || payload?.videoId : payload?.videoId;
        const state = player?.queue?.getState();
        const nav = player?.getNavInfo();
        return {
            eventType: typeof event?.eventType === 'string' && /^[A-Z_]{1,40}$/.test(event.eventType) ? event.eventType : undefined,
            eventVideoId: event?.videoId,
            videoIdsCount: ids?.length,
            selectedInVideoIds: ids && typeof selected === 'string' ? ids.includes(selected) : undefined,
            currentVideoId: state?.current?.id,
            nextVideoId: state?.next?.id,
            autoplayVideoId: state?.autoplay?.id,
            queueLength: state?.videoIds?.length,
            queueUpdating: player?.queue?.isUpdating,
            autoplayMode: player?.queue?.autoplayMode,
            hasNext: nav?.hasNext
        };
    } catch (_) { return {}; }
}
function m1sTraceSenderPresence(logger, player, payload, devices, parsed, registered, AID, clientKey, activeClientKey, state) {
    try {
        let details;
        try { details = payload?.connectionEventDetails ? JSON.parse(payload.connectionEventDetails) : null; }
        catch (_) { details = null; }
        const changedId = details?.deviceId;
        const raw = Array.isArray(devices) ? devices : null;
        const senders = Array.isArray(parsed) ? parsed : [];
        const known = Array.isArray(registered) ? registered : [];
        const ui = details?.ui;
        const safeUi = ui === undefined || ui === null || typeof ui === 'boolean' || ui === 'true' || ui === 'false'
            ? ui : '<invalid>';
        const behavior = details?.disconnectBehavior;
        // Public Google TV disconnect-reason enum; never print an arbitrary
        // value supplied in the event's metadata, even if it resembles an enum.
        const behaviorPrefix = 'MDX_SESSION_DISCONNECT_BEHAVIOR_';
        const knownBehaviors = ('UNKNOWN DISCONNECTED_BY_USER ROUTE_UNSELECTED INCOGNITO NETWORK USER_CHANGED SCREEN_APP_STOPPED '
            + 'CONNECTION_TIMEOUT CLOUD_SCREEN_NOT_FOUND CLOUD_NO_LOUNGE_TOKEN DIAL_MISSING_URL DIAL_WAKE_ON_LAN_FAILED DIAL_SERVER_ERROR '
            + 'DIAL_CLIENT_ERROR NETWORK_CHANGED LOUNGE_TOKEN_REQUEST_FAILED MDX_STOPPED BROWSER_CHANNEL_ERROR RECONNECT_REQUEST_FAILED '
            + 'CAST_SDK_DISCONNECTED LOUNGE_TOKEN_UNAUTHORIZED APP_TERMINATED MULTI_USER_NOT_ALLOWED DIAL_SCREEN_UNAVAILABLE '
            + 'CAST_AUTHENTICATION_FAILURE CAST_SDK_CANCELLED NOT_ONLINE UNMATCHING_THEME RECEIVER_DEAD_AFTER_RECEIVER_PING '
            + 'KIDS_ON_CAST_ICON_VISIBILITY_HIDDEN DIAL_CLOUD_SCREEN_FOR_PAIRING_CODE_NOT_FOUND DIAL_RECOVERY_SMOOTH_PAIRING_SCREEN_NOT_ONLINE '
            + 'DIAL_RECOVERY_WAKE_ON_LAN_STARTED CLOUD_CHANNEL_NETWORK_ERROR WEB_SOCKET_NETWORK_ERROR CAST_SDK_NETWORK_ERROR '
            + 'DIAL_LAUNCH_NETWORK_ERROR NETWORK_CHANGED_ON_REACHABILITY_UPDATE CAST_DISCONNECT_TIMEOUT APP_LAUNCH_CAST_INIT_TIMEOUT '
            + 'CAST_SESSION_START_FAILED_ERROR GENERAL_CAST_SDK_DISCONNECT NEW_SENDER_WITH_DIFFERENT_THEME '
            + 'RECONNECTING_SENDER_DOES_NOT_MATCH_LAST_MANUAL_CONNECTED_SENDER_THEME DISCONNECTED_BY_USER_PLAY_ON_PHONE '
            + 'DISCONNECTED_BY_USER_SCREEN_INITIATED APP_MOVED_TO_BACKGROUND COMPROMISED_RECEIVER SHORTS_ACTIVE_PLAYBACK NO_ACTIVE_PLAYBACK '
            + 'CRAYOLA_UNSUPPORTED ACCOUNT_LOCKED').split(' ');
        const safeBehavior = behavior === undefined || behavior === null ? behavior
            : typeof behavior === 'string' && behavior.startsWith(behaviorPrefix)
                && knownBehaviors.includes(behavior.slice(behaviorPrefix.length))
                ? behavior : '<invalid>';
        m1sTraceCastControl(logger, player, 'sender_presence', {
            AID, clientKey, activeClientKey, state,
            totalDevices: raw?.length,
            nonScreenDevices: raw?.filter(device => device?.type !== 'LOUNGE_SCREEN').length,
            remoteControlDevices: raw?.filter(device => device?.type === 'REMOTE_CONTROL').length,
            parsedSenders: senders.length,
            registeredSenders: known.length,
            changedKnown: changedId ? known.some(sender => sender?.id === changedId) : undefined,
            changedInRaw: changedId && raw ? raw.some(device => device?.id === changedId) : undefined,
            changedInParsed: changedId ? senders.some(sender => sender?.id === changedId) : undefined,
            ui: safeUi, uiType: typeof ui, disconnectBehavior: safeBehavior
        });
    } catch (_) {
        // Inspecting sender presence must never affect connection decisions.
    }
}
`;

/** Add diagnostics to pinned control paths without changing their decisions. */
export function patchControlTrace(input, version) {
  if (version !== '2.1.0') throw new Error(`Cast control trace requires yt-cast-receiver 2.1.0; got ${version}`);
  let source = input.replace(/\r\n/g, '\n');
  const player = '__classPrivateFieldGet(this, _YouTubeApp_player, "f")';
  const logger = '__classPrivateFieldGet(this, _YouTubeApp_logger, "f")';
  const active = '__classPrivateFieldGet(this, _YouTubeApp_activeSession, "f")';
  const presenceAnchor = '            if (this.state === STATUSES.STARTING) {';
  const presenceTrace = `            try {
                m1sTraceSenderPresence(${logger}, ${player}, payload, loungeDevices, loungeStatusSenders,
                    __classPrivateFieldGet(this, _YouTubeApp_connectedSenders, "f"), AID, client?.key, ${active}?.client?.key, this.state);
            } catch (_) {
                // Diagnostic reads must never alter the sender lifecycle.
            }
`;
  if (source.includes(marker)) {
    const pattern = /^\/\/ M1S control lifecycle trace v3\nfunction m1sTraceCastControl\([\s\S]*?\n}\nfunction m1sTracePlaylistFields\([\s\S]*?\n}\nfunction m1sTraceSenderPresence\([\s\S]*?\n}\n/m;
    if (source.split(marker).length !== 2 || !pattern.test(source) || source.split(presenceTrace).length !== 2)
      throw new Error('Cast control trace helper target mismatch');
    return source.replace(pattern, helper);
  }
  if (source.includes(previousMarker)) {
    const pattern = /^\/\/ M1S control lifecycle trace v2\nfunction m1sTraceCastControl\([\s\S]*?\n}\nfunction m1sTracePlaylistFields\([\s\S]*?\n}\n/m;
    if (source.split(previousMarker).length !== 2 || !pattern.test(source) || source.split(presenceAnchor).length !== 2)
      throw new Error('Cast control trace upgrade target mismatch');
    return source.replace(pattern, helper).replace(presenceAnchor, presenceTrace + presenceAnchor);
  }
  const alreadyTraced = source.includes(oldMarker);
  if (alreadyTraced) {
    const pattern = /^\/\/ M1S control lifecycle trace v1\nfunction m1sTraceCastControl\([\s\S]*?\n}\n/m;
    if (source.split(oldMarker).length !== 2 || !pattern.test(source)) throw new Error('Cast control trace upgrade target mismatch');
    source = source.replace(pattern, '');
  }
  const replaceOnce = (needle, replacement) => {
    if (source.split(needle).length !== 2) throw new Error(`Cast control trace target mismatch: ${needle.slice(0, 90)}`);
    source = source.replace(needle, replacement);
  };
  const trace = (event, fields) => `m1sTraceCastControl(${logger}, ${player}, '${event}', { ${fields} });`;

  replaceOnce(presenceAnchor, presenceTrace + presenceAnchor);

  if (alreadyTraced) {
    const oldIncomingEnd = "currentTime: name === 'seekTo' ? payload?.newTime : payload?.currentTime });";
    replaceOnce(oldIncomingEnd, "currentTime: name === 'seekTo' ? payload?.newTime : payload?.currentTime, ...m1sTracePlaylistFields(payload, " + player + ') });');
  }

  const incoming = '    const sendMessages = [];\n    switch (name) {';
  if (!alreadyTraced) replaceOnce(incoming, `    if (['setPlaylist', 'updatePlaylist', 'play', 'pause', 'stopVideo', 'next', 'previous', 'seekTo'].includes(name)) {
        ${trace('incoming', "command: name, AID, clientKey: client?.key, activeClientKey: " + active + "?.client?.key, allowed: m1sCanControl, videoId: payload?.videoId, listId: payload?.listId, currentIndex: payload?.currentIndex, currentIndexType: typeof payload?.currentIndex, currentTime: name === 'seekTo' ? payload?.newTime : payload?.currentTime, ...m1sTracePlaylistFields(payload, " + player + ')')}
    }
${incoming}`);

  const queueUpdated = `            if (this.m1sPlaylistSelectionToken !== m1sSelectionToken
                || (${player}.queue.current?.id || null) !== m1sSelectedId) return;`;
  // This token check occurs once before dispatch and again inside the Play
  // completion guard. Only the first, column-aligned one is the queue boundary.
  replaceOnce(queueUpdated, `            ${trace('queue_updated', `command: name, AID, clientKey: client?.key, activeClientKey: ${active}?.client?.key, obsolete: this.m1sPlaylistSelectionToken !== m1sSelectionToken, ...m1sTracePlaylistFields(payload, ${player})`)}
${queueUpdated}`);

  if (alreadyTraced) return helper + source;

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
