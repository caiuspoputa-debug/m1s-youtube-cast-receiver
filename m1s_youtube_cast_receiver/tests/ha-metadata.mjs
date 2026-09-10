import assert from 'node:assert/strict';
import fs from 'node:fs';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';

const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const classText = source.slice(source.indexOf('class M1SPlayer extends Player {'), source.indexOf('\nasync function initializeVolume'));
const calls = [];
const timers = [];
const setTimeoutFake = (fn, ms) => {
  const timer = { fn, ms, unref() {} };
  timers.push(timer);
  return timer;
};
const clearTimeoutFake = () => {};
class Base {
  constructor() { this.status = Constants.PLAYER_STATUSES.PLAYING; }
}
const M1SPlayer = new Function(
  'Player', 'Constants', 'log', 'sleep', 'haDomainService', 'setTimeout', 'clearTimeout',
  `${classText}\nreturn M1SPlayer;`
)(Base, Constants, () => {}, async () => {}, async (...args) => calls.push(args), setTimeoutFake, clearTimeoutFake);

const player = new M1SPlayer({ name: 'Test', entityId: 'media_player.test' });
player.currentVideoId = 'abcdefghi01';
player.playGeneration = 4;
player.continuousSession = { active: true, url: 'http://host/stream/test/7.wav' };
player.ownsTarget = true;
player.title = 'Artist - Track';
player.artist = 'Artist';
player.channel = 'YouTube Music';
player.scheduleHomeAssistantMetadata(player.currentVideoId, 4);
assert.equal(timers.at(-1).ms, 4000);
timers.at(-1).fn();
for (let i = 0; i < 4; i += 1) await Promise.resolve();
assert.equal(calls.length, 1);
assert.equal(calls[0][0], 'aqara_m1s_zigbee_router');
assert.equal(calls[0][1], 'update_media_metadata');
assert.deepEqual(calls[0][2], {
  entity_id: 'media_player.test',
  expected_media_content_id: 'http://host/stream/test/7.wav',
  title: 'Artist - Track',
  artist: 'Artist',
  channel: 'YouTube Music'
});
assert.equal(player.metadataPublishedGeneration, 4);

player.playGeneration = 5;
assert.equal(await player.publishHomeAssistantMetadata('abcdefghi01', 4), false);
player.playGeneration = 4;
player.currentVideoId = 'different01';
assert.equal(await player.publishHomeAssistantMetadata('abcdefghi01', 4), false);
player.currentVideoId = 'abcdefghi01';
player.ownsTarget = false;
assert.equal(await player.publishHomeAssistantMetadata('abcdefghi01', 4), false);
assert.equal(calls.length, 1);
console.log('PASS: HA metadata waits four seconds, carries title/artist/channel and exact stream identity; stale or unowned updates are rejected.');
