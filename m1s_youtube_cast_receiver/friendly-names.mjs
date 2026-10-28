const FIXED_PREFIX = 'MP';

export function detectedReceiverName(value) {
  return String(value || '').normalize('NFC')
    .replace(/(^|[^\p{L}\p{N}])(\d{1,3}(?:[._\s-]+\d{1,3}){3})(?=$|[^\p{L}\p{N}])/gu,
      (match, boundary, address) => address.split(/[._\s-]+/).every(part => Number(part) <= 255) ? boundary : match)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[^\p{L}\p{M}\p{N}])(\p{L})/gu,
      (_match, boundary, letter) => boundary + letter.toLocaleUpperCase('ro-RO'));
}

export function friendlyNameBase(value) {
  return String(value || '')
    .replace(/^\s*mp(?:\s+|-)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function castFriendlyName(value, fallback = 'Receiver') {
  const base = friendlyNameBase(value) || friendlyNameBase(fallback) || 'Receiver';
  return `${FIXED_PREFIX} ${base}`;
}

export function parseFriendlyNameOverrides(value) {
  const overrides = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const entityId = String(item?.entity_id || '').trim().toLowerCase();
    const friendlyName = String(item?.friendly_name || '').trim();
    if (!entityId.startsWith('media_player.') || !friendlyName) continue;
    overrides.set(entityId, friendlyName);
  }
  return overrides;
}

export function friendlyNameOverride(overrides, entityId) {
  if (!(overrides instanceof Map)) return '';
  return overrides.get(String(entityId || '').trim().toLowerCase()) || '';
}
