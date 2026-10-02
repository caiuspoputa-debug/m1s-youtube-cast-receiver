import fs from 'node:fs';

export const FRIENDLY_NAMES_PATH = '/data/cast-friendly-names.json';

export function sanitizeFriendlyNameEntries(value, allowedEntityIds = null) {
  const allowed = allowedEntityIds instanceof Set
    ? new Set([...allowedEntityIds].map((item) => String(item).toLowerCase()))
    : null;
  const entries = [];
  const seen = new Set();

  for (const item of Array.isArray(value) ? value : []) {
    const entityId = String(item?.entity_id || '').trim().toLowerCase();
    const friendlyName = String(item?.friendly_name || '').replace(/\s+/g, ' ').trim();
    if (!entityId.startsWith('media_player.') || !friendlyName) continue;
    if (friendlyName.length > 64 || seen.has(entityId)) continue;
    if (allowed && !allowed.has(entityId)) continue;
    seen.add(entityId);
    entries.push({ entity_id: entityId, friendly_name: friendlyName });
  }

  return entries;
}

export function readFriendlyNameEntries(filePath = FRIENDLY_NAMES_PATH) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitizeFriendlyNameEntries(Array.isArray(payload) ? payload : payload?.names);
  } catch (_) {
    return [];
  }
}

export async function writeFriendlyNameEntries(
  value,
  allowedEntityIds,
  filePath = FRIENDLY_NAMES_PATH
) {
  const entries = sanitizeFriendlyNameEntries(value, allowedEntityIds);
  const temporaryPath = `${filePath}.tmp`;
  const payload = JSON.stringify({ version: 1, names: entries }, null, 2);
  await fs.promises.writeFile(temporaryPath, `${payload}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(temporaryPath, filePath);
  return entries;
}
