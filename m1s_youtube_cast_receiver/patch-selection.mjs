import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep this self-contained: the same function is inserted in the pinned
// dependency so a clean npm install needs only this patch script.
export function normalizeM1sSelection(message, existing = null) {
  const payload = message?.payload || {};
  let event = null;
  let eventType = null;
  try {
    event = typeof payload.eventDetails === 'string'
      ? JSON.parse(payload.eventDetails) : payload.eventDetails;
    eventType = event?.eventType;
  } catch (_) { /* Preserve the dependency's handling of malformed event details. */ }

  if (eventType === 'PLAYLIST_CLEARED') {
    return { ...payload, listId: null, videoId: null, videoIds: '',
      currentIndex: undefined, __m1sSelectedVideo: false };
  }
  const selectedEvent = eventType === 'VIDEO_SELECTED';
  if (message?.name !== 'setPlaylist' && !(message?.name === 'updatePlaylist' && selectedEvent)) {
    return { ...payload, __m1sSelectedVideo: false };
  }

  const id = String((selectedEvent && event?.videoId) || payload.videoId || '');
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
    return { ...payload, __m1sSelectedVideo: false };
  }
  let ids = typeof payload.videoIds === 'string'
    ? payload.videoIds.split(',').filter(Boolean) : [];
  if (!Object.prototype.hasOwnProperty.call(payload, 'videoIds')
      && payload.listId && payload.listId === existing?.id
      && Array.isArray(existing?.videoIds) && existing.videoIds.includes(id)) {
    ids = existing.videoIds.slice();
  }
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
  prepare('dist/lib/app/Playlist.js', '// M1S selection payload patch v4: preserve known same-list selections', (source, replace) => {
    const oldMarker = '// M1S selection payload patch: standalone video and numeric zero';
    const versionTwo = '// M1S selection payload patch v2: standalone video, zero index and navigation identity';
    const versionThree = '// M1S selection payload patch v3: explicit selection events and navigation identity';
    const alreadyEventAware = source.includes(`${versionThree}\n`);
    const alreadyGuarded = alreadyEventAware || source.includes(`${versionTwo}\n`);
    const alreadyNormalized = alreadyGuarded || source.includes(`${oldMarker}\n`);
    if (alreadyNormalized) {
      source = replace(source, `${alreadyEventAware ? versionThree : alreadyGuarded ? versionTwo : oldMarker}\n`, '');
      const helper = source.match(/^function normalizeM1sSelection\(message(?:, existing = null)?\) \{[\s\S]*?^\}\n/m)?.[0];
      if (!helper) throw new Error('Unexpected pinned Playlist.js helper; refusing partial selection patch');
      source = replace(source, helper, `${normalizeM1sSelection.toString()}\n`);
      source = replace(source, alreadyEventAware
        ? '        const data = normalizeM1sSelection(message, this.getState());'
        : '        const data = normalizeM1sSelection(message);',
        '        const data = normalizeM1sSelection(message, this.getState());');
    } else {
      source = replace(source, '        const data = message.payload;\n        if (!data.listId) {',
        '        const data = normalizeM1sSelection(message, this.getState());\n        if (!data.listId && !data.__m1sSelectedVideo) {');
      source = replace(source, '            if (data.currentIndex && data.videoId) {',
        '            if (data.__m1sSelectedVideo) {');
    }
    source = replace(source, alreadyEventAware
      ? "        if (message.name === 'setPlaylist' || data.__m1sSelectedVideo) {"
      : "        if (message.name === 'setPlaylist') {",
      "        if (message.name === 'setPlaylist' || data.__m1sSelectedVideo) {");
    const navigationPatches = [
      ['            __classPrivateFieldSet(this, _Playlist_previousNextAbortController, new AbortController(), "f");',
        `            const m1sNavigationVideo = __classPrivateFieldGet(this, _Playlist_current, "f");
            const m1sNavigationController = new AbortController();
            __classPrivateFieldSet(this, _Playlist_previousNextAbortController, m1sNavigationController, "f");`],
      ['                nav = await __classPrivateFieldGet(this, _Playlist_requestHandler, "f").getPreviousNextVideosAbortable(__classPrivateFieldGet(this, _Playlist_current, "f"), this, __classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f").signal);',
        `                nav = await __classPrivateFieldGet(this, _Playlist_requestHandler, "f").getPreviousNextVideosAbortable(m1sNavigationVideo, this, m1sNavigationController.signal);
                if (m1sNavigationController.signal.aborted
                    || __classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f") !== m1sNavigationController
                    || __classPrivateFieldGet(this, _Playlist_current, "f") !== m1sNavigationVideo) return;`],
      ['                __classPrivateFieldSet(this, _Playlist_previousNextAbortController, null, "f");',
        `                if (__classPrivateFieldGet(this, _Playlist_previousNextAbortController, "f") === m1sNavigationController) {
                    __classPrivateFieldSet(this, _Playlist_previousNextAbortController, null, "f");
                }`]
    ];
    for (const [before, after] of navigationPatches) {
      source = replace(source, alreadyGuarded ? after : before, after);
    }
    return alreadyNormalized ? source : `${normalizeM1sSelection.toString()}\n${source}`;
  });
  prepare('dist/lib/app/YouTubeApp.js', '// M1S explicit selection dispatch v3: retain known same-list queue', (source, replace) => {
    const versionTwo = '// M1S explicit selection dispatch v2: setPlaylist and VIDEO_SELECTED';
    if (source.includes(`${versionTwo}\n`)) {
      source = replace(source, `${versionTwo}\n`, '');
      const helper = source.match(/^function normalizeM1sSelection\(message, existing = null\) \{[\s\S]*?^\}\n/m)?.[0];
      if (!helper) throw new Error('Unexpected pinned YouTubeApp.js helper; refusing partial selection patch');
      source = replace(source, helper, `${normalizeM1sSelection.toString()}\n`);
      for (const known of [
        `            const m1sPlaySelection = message.name === 'setPlaylist'
                || normalizeM1sSelection(message, stateBeforeSet).__m1sSelectedVideo;`,
        '            if (m1sPlaySelection && m1sImmediateCurrent',
        '            if (m1sPlaySelection && (stateBeforeSet.current?.id !== stateAfterSet.current?.id ||'
      ]) source = replace(source, known, known);
      return source;
    }
    const oldMarker = '// M1S explicit selection starts before remote navigation';
    const alreadyDispatched = source.includes(`${oldMarker}\n`);
    if (alreadyDispatched) {
      source = replace(source, `${oldMarker}\n`, '');
    } else {
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
    }
    source = replace(source,
      '            const m1sSelectionToken = (this.m1sPlaylistSelectionToken || 0) + 1;',
      `            const m1sPlaySelection = message.name === 'setPlaylist'
                || normalizeM1sSelection(message, stateBeforeSet).__m1sSelectedVideo;
            const m1sSelectionToken = (this.m1sPlaylistSelectionToken || 0) + 1;`);
    source = replace(source, "            if (message.name === 'setPlaylist' && m1sImmediateCurrent",
      '            if (m1sPlaySelection && m1sImmediateCurrent');
    source = replace(source,
      "            if (message.name === 'setPlaylist' && (stateBeforeSet.current?.id !== stateAfterSet.current?.id ||",
      '            if (m1sPlaySelection && (stateBeforeSet.current?.id !== stateAfterSet.current?.id ||');
    return `${normalizeM1sSelection.toString()}\n${source}`;
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
  console.log(changed ? 'M1S: explicit Cast selection events and queue retention patch applied.'
    : 'M1S: Cast selection patch already applied.');
}
