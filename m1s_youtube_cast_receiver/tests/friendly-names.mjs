import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  castFriendlyName,
  detectedReceiverName,
  friendlyNameBase,
  friendlyNameOverride,
  parseFriendlyNameOverrides
} from '../friendly-names.mjs';

assert.equal(castFriendlyName('Living'), 'MP Living');
assert.equal(castFriendlyName('MP Living'), 'MP Living');
assert.equal(castFriendlyName('  MP   Living  '), 'MP Living');
assert.equal(castFriendlyName('', 'Group'), 'MP Group');
assert.equal(friendlyNameBase('MP Balcon'), 'Balcon');
for (const value of ['bucătărie 192.168.0.210', 'Bucătărie_192_168_0_210', 'bucătărie 192 168 0 210']) {
  assert.equal(castFriendlyName(detectedReceiverName(value)), 'MP Bucătărie');
}
assert.equal(detectedReceiverName('cameră mică 10.0.0.2'), 'Cameră Mică');
assert.equal(detectedReceiverName('baie și șifonier'), 'Baie Și Șifonier');
assert.equal(detectedReceiverName('bucăta\u0306rie_192_168_0_210'), 'Bucătărie');
assert.equal(detectedReceiverName('etaj 2'), 'Etaj 2');
assert.equal(detectedReceiverName('camera 999.168.0.210'), 'Camera 999.168.0.210');

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

const index = fs.readFileSync(new URL('../index.mjs', import.meta.url),'utf8');
const receiverFunction = index.slice(index.indexOf('function receiverNameFromState('), index.indexOf('const INCLUDE_SWITCH_SUFFIX'));
const context = vm.createContext({cfg:{individualFriendlyNames:new Map()},castFriendlyName,detectedReceiverName,friendlyNameOverride});
vm.runInContext(receiverFunction,context);
const entity_id = 'media_player.aqara_m1s_zigbee_router_bucatarie_192_168_0_210_media_player';
assert.equal(context.receiverNameFromState({entity_id,attributes:{friendly_name:'Aqara M1S Zigbee Router bucătărie 192.168.0.210 Media Player'}}),'MP Bucătărie');
assert.equal(context.receiverNameFromState({entity_id,attributes:{}}),'MP Bucatarie');
context.cfg.individualFriendlyNames.set(entity_id,'Numele Meu');
assert.equal(context.receiverNameFromState({entity_id,attributes:{friendly_name:'alt nume'}}),'MP Numele Meu');

console.log('Friendly-name tests passed.');
