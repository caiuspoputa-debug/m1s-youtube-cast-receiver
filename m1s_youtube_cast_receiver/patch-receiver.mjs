import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] || path.join(here, 'node_modules/yt-cast-receiver');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '2.1.0') throw Error('Receiver patch requires exact yt-cast-receiver 2.1.0');
const marker = '// M1S 1.0.5 receiver navigation patch';
function patch(file, transform) {
  const name = path.join(root, 'dist/lib/app', file);
  const source = fs.readFileSync(name, 'utf8').replace(/\r\n/g, '\n');
  if (source.includes(marker)) return;
  fs.writeFileSync(name, marker + '\n' + transform(source));
}
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Unexpected dependency source; refusing partial patch');
  return source.replace(before, after);
}
patch('YouTubeApp.js', source => replaceOnce(replaceOnce(source,
`                if (__classPrivateFieldGet(this, _YouTubeApp_player, "f").status !== PLAYER_STATUSES.STOPPED) {
                    await __classPrivateFieldGet(this, _YouTubeApp_player, "f").stop(AID);
                }
                const currentVideo = stateAfterSet.current;`,
`                // Player.play owns replacement; pre-stopping here destroys Cast continuity.
                if (!stateAfterSet.current) await __classPrivateFieldGet(this, _YouTubeApp_player, "f").stop(AID);
                const currentVideo = stateAfterSet.current;`),
  '    if (nowPlayingChanged || (statusChanged && (!previous || previous.status !== PLAYER_STATUSES.PLAYING))) {',
  '    if (nowPlayingChanged || autoplayChanged || (statusChanged && (!previous || previous.status !== PLAYER_STATUSES.PLAYING))) {'));
patch('DefaultPlaylistRequestHandler.js', source => {
  const start = source.indexOf('            const autoplaySet = nextResponse.data?');
  const end = source.indexOf('            const parsedEndpoints =', start);
  if (start < 0 || end < 0) throw Error('Navigation parser patch target missing');
  source = source.slice(0,start) + `            let navigation = extractNavigation(nextResponse.data);
            if (!navigation.next && !navigation.autoplay) {
                // Retry watch-next using the library's current WEB context. Keep the
                // same video, playlist and credential-transfer context; no random mix.
                __classPrivateFieldGet(this, _DefaultPlaylistRequestHandler_instances, "m", _DefaultPlaylistRequestHandler_configureInnertubeContext).call(this, target, 'initial');
                try {
                    const webResponse = await __classPrivateFieldGet(this, _DefaultPlaylistRequestHandler_innertube, "f").actions.execute('/next', endpoint.payload);
                    const web = extractNavigation(webResponse.data);
                    navigation = { previous: navigation.previous || web.previous, next: web.next, autoplay: web.autoplay };
                } catch (_) {
                    this.logger.warn('[M1S-YT] WEB next lookup unavailable; no successor invented.');
                }
            }
            const previousRendererEndpoint = navigation.previous;
            const nextRendererEndpoint = navigation.next;
            const autoplayRendererEndpoint = navigation.autoplay;
` + source.slice(end);
  return "import { extractNavigation } from './m1s-next-navigation.mjs';\n" + source;
});
fs.copyFileSync(path.join(here, 'next-navigation.mjs'),path.join(root,'dist/lib/app/m1s-next-navigation.mjs'));
console.log('M1S 1.0.5: receiver navigation and playlist replacement patches applied.');
