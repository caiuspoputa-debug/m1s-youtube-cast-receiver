export const DEFAULT_INDIVIDUAL_MATCH = 'aqara_m1s_zigbee';
export const LEGACY_ROUTER_MATCH = 'aqara_m1s_zigbee_router';

export function normalizeIndividualMatch(value) {
  const match = String(value || DEFAULT_INDIVIDUAL_MATCH).trim().toLowerCase();
  if (!match || match === LEGACY_ROUTER_MATCH) return DEFAULT_INDIVIDUAL_MATCH;
  return match;
}

export function individualReceiverMatches(state, match) {
  const entityId = String(state?.entity_id || '');
  const friendlyName = String(state?.attributes?.friendly_name || '');
  const haystack = `${entityId} ${friendlyName}`.toLowerCase();
  return haystack.includes(normalizeIndividualMatch(match));
}
