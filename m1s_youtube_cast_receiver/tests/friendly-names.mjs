import assert from 'node:assert/strict';
import {
  castFriendlyName,
  friendlyNameBase,
  friendlyNameOverride,
  parseFriendlyNameOverrides
} from '../friendly-names.mjs';

assert.equal(castFriendlyName('Living'), 'MP Living');
assert.equal(castFriendlyName('MP Living'), 'MP Living');
assert.equal(castFriendlyName('  MP   Living  '), 'MP Living');
assert.equal(castFriendlyName('', 'Group'), 'MP Group');
assert.equal(friendlyNameBase('MP Balcon'), 'Balcon');

const overrides = parseFriendlyNameOverrides([
  {
    entity_id: 'media_player.aqara_m1s_zigbee_router_192_168_0_221_media_player',
    friendly_name: 'Balcon'
  },
  {
    entity_id: 'switch.not_a_player',
    friendly_name: 'Ignored'
  },
  {
    entity_id: 'media_player.blank_name',
    friendly_name: ''
  }
]);

assert.equal(
  friendlyNameOverride(
    overrides,
    'MEDIA_PLAYER.AQARA_M1S_ZIGBEE_ROUTER_192_168_0_221_MEDIA_PLAYER'
  ),
  'Balcon'
);
assert.equal(friendlyNameOverride(overrides, 'media_player.missing'), '');

console.log('Friendly-name tests passed.');
