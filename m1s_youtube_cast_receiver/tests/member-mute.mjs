import assert from 'node:assert/strict';
import fs from 'node:fs';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';

const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const classText = source.slice(
  source.indexOf('class M1SPlayer extends Player {'),
  source.indexOf('\nasync function initializeVolume')
);

const calls = [];
let homeAssistantMuted = true;
const haService = async (entityId, service, data) => {
  calls.push({ entityId, service, data });
};
const haRequest = async () => ({
  attributes: { is_volume_muted: homeAssistantMuted }
});
class BasePlayer {}
const M1SPlayer = new Function(
  'Player', 'Constants', 'log', 'sleep', 'haService', 'haRequest',
  `${classText}\nreturn M1SPlayer;`
)(BasePlayer, Constants, () => {}, async () => {}, haService, haRequest);

const player = new M1SPlayer({
  name: 'Bucataria de vara',
  entityId: 'media_player.bucataria_de_vara'
});
player.volume = { level: 6, muted: true };

await player.doSetVolume({ level: 7, muted: false });
assert.deepEqual(calls, [{
  entityId: 'media_player.bucataria_de_vara',
  service: 'volume_set',
  data: { volume_level: 0.07 }
}]);
assert.deepEqual(player.volume, { level: 7, muted: true });

calls.length = 0;
homeAssistantMuted = false;
await player.doSetVolume({ level: 8, muted: true });
assert.equal(calls.length, 1);
assert.equal(calls[0].service, 'volume_set');
assert.deepEqual(player.volume, { level: 8, muted: false });

assert.ok(!source.includes("haService(this.definition.entityId, 'volume_mute'"));
console.log('PASS: Cast changes only the volume level and preserves the authoritative per-member mute from Home Assistant.');
