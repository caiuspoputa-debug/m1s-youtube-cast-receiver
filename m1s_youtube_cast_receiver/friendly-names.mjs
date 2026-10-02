const FIXED_PREFIX = 'MP';

function withoutPrefix(value) {
  return String(value || '')
    .replace(/^\s*mp(?:\s+|-)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function castFriendlyName(value, fallback = 'Receiver') {
  const base = withoutPrefix(value) || withoutPrefix(fallback) || 'Receiver';
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
