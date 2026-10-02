import assert from 'node:assert/strict';

import {
  DEFAULT_INDIVIDUAL_MATCH,
  individualReceiverMatches,
  normalizeIndividualMatch
} from '../receiver-discovery.mjs';

const coordinator = {
  entity_id: 'media_player.aqara_m1s_zigbee_coordinator_192_168_0_107_media_player',
  attributes: { friendly_name: 'Living MP Hub Coordinator' }
};
const router = {
  entity_id: 'media_player.aqara_m1s_zigbee_router_192_168_0_221_media_player',
  attributes: { friendly_name: 'Balcon MP Hub Router' }
};
const unrelated = {
  entity_id: 'media_player.living_room_tv',
  attributes: { friendly_name: 'Living TV' }
};

assert.equal(normalizeIndividualMatch(), DEFAULT_INDIVIDUAL_MATCH);
assert.equal(normalizeIndividualMatch('aqara_m1s_zigbee_router'), DEFAULT_INDIVIDUAL_MATCH);
assert.equal(normalizeIndividualMatch('ROUTER_192_168_0_221'), 'router_192_168_0_221');
assert.equal(individualReceiverMatches(coordinator, DEFAULT_INDIVIDUAL_MATCH), true);
assert.equal(individualReceiverMatches(router, DEFAULT_INDIVIDUAL_MATCH), true);
assert.equal(individualReceiverMatches(unrelated, DEFAULT_INDIVIDUAL_MATCH), false);
assert.equal(individualReceiverMatches(router, 'router_192_168_0_221'), true);
assert.equal(individualReceiverMatches(coordinator, 'router_192_168_0_221'), false);

console.log('Receiver discovery tests passed for coordinator, router and custom filters.');
