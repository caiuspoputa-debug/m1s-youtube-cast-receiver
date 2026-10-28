import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep this self-contained: the same function is inserted in the pinned
// dependency so a clean npm install needs only this patch script.
export function normalizeM1sSelection(message) {
  const payload = message?.payload || {};
  let eventType = null;
  try {
    const event = typeof payload.eventDetails === 'string'
      ? JSON.parse(payload.eventDetails) : payload.eventDetails;
    eventType = event?.eventType;
  } catch (_) { /* Preserve the dependency's handling of malformed event details. */ }

  if (eventType === 'PLAYLIST_CLEARED') {
    return { ...payload, listId: null, videoId: null, videoIds: '',
      currentIndex: undefined, __m1sSelectedVideo: false };
  }
  if (message?.name !== 'setPlaylist') {
    return { ...payload, __m1sSelectedVideo: false };
  }

  const id = String(payload.videoId || '');
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
    return { ...payload, __m1sSelectedVideo: false };
  }
  let ids = typeof payload.videoIds === 'string'
    ? payload.videoIds.split(',').filter(Boolean) : [];
  // A standalone selection carries its own video ID without a playlist ID or
  // queue. Keep that explicit selection; do not invent a YouTube playlist ID.
  if (!ids.includes(id)) ids = [id];
  const supplied = typeof payload.currentIndex === 'number'
    || (typeof payload.currentIndex === 'string' && payload.currentIndex.trim() !== '')
    ? Number(payload.currentIndex) : NaN;
  const index = Number.isInteger(supplied) && supplied >= 0 && ids[supplied] === id
    ? supplied : ids.indexOf(id);
  return { ...payload, listId: payload.listId || null, videoId: id,
    videoIds: ids.join(','), currentIndex: index, __m1sSelectedVideo: true };
}

export function patchSelection(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== '2.1.0') throw new Error('Selection patch requires exact yt-cast-receiver 2.1.0');
  const changes = [];
  function prepare(relative, marker, transform) {
    const filename = path.join(root, relative);
    const source = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
    if (source.includes(marker)) return;
    const patched = transform(source, (value, before, after) => {
      if (value.split(before).length !== 2) {
        throw new Error(`Unexpected pinned ${path.basename(filename)} source; refusing partial selection patch`);
      }
      return value.replace(before, after);
    });
    changes.push([filename, `${marker}\n${patched}`]);
  }
  prepare('dist/lib/app/Playlist.js', '// M1S selection payload patch v2: standalone video, zero index and navigation identity', (source, replace) => {
    const oldMarker = '// M1S selection payload patch: standalone video and numeric zero';
    const alreadyNormalized = source.includes(`${oldMarker}\n`);
    if (alreadyNormalized) {
      source = source.replace(`${oldMarker}\n`, '');
    } else {
      source = replace(source, '        const data = message.payload;\n        if (!data.listId) {',
        '        const data = normalizeM1sSelection(message);\n        if (!data.listId && !data.__m1sSelectedVideo) {');
      source = replace(source, '            if (data.currentIndex && data.videoId) {',
        '            if (data.__m1sSelectedVideo) {');
    }
    source = replace(source,
      '            __classPrivateFieldSet(this, _Playlist_previousNextAbortController, new AbortController(), "f");',
      `            const m1sNavigationVideo = __classPrivateFieldGet(this, _Playlist_current, "f");
            const m1sNavigationController = new AbortController();
            __classPrivateFieldSet(this, _Playlist_previousNextAbortController, m1sNavigationController, "f");`);
    source = replace(source,
      '                nav = await __classPrivateFieldGet(this, _Playlist_requestHandler, "f").getPreviousNextVideosAbortable(__classPrivateFieldGet(this, _Playlist_current, "f"), this, __classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f").signal);',
      `                nav = await __classPrivateFieldGet(this, _Playlist_requestHandler, "f").getPreviousNextVideosAbortable(m1sNavigationVideo, this, m1sNavigationController.signal);
                if (m1sNavigationController.signal.aborted
                    || __classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f") !== m1sNavigationController
                    || __classPrivateFieldGet(this, _Playlist_current, "f") !== m1sNavigationVideo) return;`);
    source = replace(source,
      '                __classPrivateFieldSet(this, _Playlist_previousNextAbortController, null, "f");',
      `                if (__classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f") === m1sNavigationController) {
                    __classPrivateFieldSet(this, _Playlist_previousNextAbortController, null, "f");
                }`);
    return alreadyNormalized ? source : `${normalizeM1sSelection.toString()}\n${source}`;
  });
  prepare('dist/lib/app/YouTubeApp.js', '// M1S explicit selection starts before remote navigation', (source, replace) => {
    source = replace(source,
      '            await __classPrivateFieldGet(this, _YouTubeApp_player, "f").queue.updateByMessage(message, client);',
      `            const m1sSelectionToken = (this.m1sPlaylistSelectionToken || 0) + 1;
            this.m1sPlaylistSelectionToken = m1sSelectionToken;
            const m1sQueueUpdate = __classPrivateFieldGet(this, _YouTubeApp_player, "f").queue.updateByMessage(message, client);
            const m1sImmediateCurrent = __classPrivateFieldGet(this, _YouTubeApp_player, "f").queue.current;
            const m1sSelectedId = m1sImmediateCurrent?.id || null;
            let m1sEarlyPlay = null;
            if (message.name === 'setPlaylist' && m1sImmediateCurrent
                && (stateBeforeSet.current?.id !== m1sImmediateCurrent.id
                    || stateBeforeSet.current?.context?.index !== m1sImmediateCurrent.context?.index)) {
                // updateByMessage has synchronously selected the new video but
                // may still be resolving remote navigation. Start Play now so
                // its LOADING snapshot cannot carry the predecessor's clock.
                try {
                    m1sEarlyPlay = Promise.resolve(__classPrivateFieldGet(this, _YouTubeApp_player, "f").play(
                        m1sImmediateCurrent, parseInt(payload.currentTime, 10) || 0, AID))
                        .then(value => ({ value }), error => ({ error }));
                } catch (error) {
                    m1sEarlyPlay = Promise.resolve({ error });
                }
            }
            try {
                await m1sQueueUpdate;
            } catch (error) {
                if (!m1sEarlyPlay) throw error;
                __classPrivateFieldGet(this, _YouTubeApp_logger, "f").warn('[M1S-YT] Navigation lookup failed after explicit selection; playback request retained.');
            }
            if (this.m1sPlaylistSelectionToken !== m1sSelectionToken
                || (__classPrivateFieldGet(this, _YouTubeApp_player, "f").queue.current?.id || null) !== m1sSelectedId) return;`);
    source = replace(source,
      '                    await __classPrivateFieldGet(this, _YouTubeApp_player, "f").play(currentVideo, parseInt(payload.currentTime, 10) || 0, AID);',
      `                    if (m1sEarlyPlay) {
                        const m1sPlayResult = await m1sEarlyPlay;
                        if (this.m1sPlaylistSelectionToken !== m1sSelectionToken
                            || __classPrivateFieldGet(this, _YouTubeApp_player, "f").queue.current?.id !== m1sSelectedId) return;
                        if (m1sPlayResult.error) throw m1sPlayResult.error;
                    } else {
                        await __classPrivateFieldGet(this, _YouTubeApp_player, "f").play(currentVideo, parseInt(payload.currentTime, 10) || 0, AID);
                    }`);
    return source;
  });
  // Validate every target before writing either file. A dependency drift in
  // the app cannot leave only the playlist half of the correction installed.
  for (const [filename, source] of changes) {
    fs.writeFileSync(filename, source);
  }
  return changes.length > 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const changed = patchSelection(process.argv[2] || path.join(here, 'node_modules/yt-cast-receiver'));
  console.log(changed ? 'M1S: standalone Cast selection and numeric zero patch applied.'
    : 'M1S: Cast selection patch already applied.');
}
