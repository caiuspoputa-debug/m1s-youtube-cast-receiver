import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  FRIENDLY_NAMES_PATH,
  readFriendlyNameEntries,
  sanitizeFriendlyNameEntries,
  writeFriendlyNameEntries
} from './friendly-name-store.mjs';

const OPTIONS_PATH = '/data/options.json';

export async function migrateLegacyFriendlyNames(
  optionsPath = OPTIONS_PATH,
  namesPath = FRIENDLY_NAMES_PATH
) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));
  } catch (_) {
    return { migrated: 0, names: readFriendlyNameEntries(namesPath) };
  }

  const legacy = sanitizeFriendlyNameEntries(raw?.individual_friendly_names);
  if (legacy.length === 0) {
    return { migrated: 0, names: readFriendlyNameEntries(namesPath) };
  }

  const merged = new Map();
  for (const item of legacy) merged.set(item.entity_id, item.friendly_name);
  for (const item of readFriendlyNameEntries(namesPath)) {
    merged.set(item.entity_id, item.friendly_name);
  }

  const names = await writeFriendlyNameEntries(
    [...merged].map(([entity_id, friendly_name]) => ({ entity_id, friendly_name })),
    null,
    namesPath
  );
  return { migrated: legacy.length, names };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await migrateLegacyFriendlyNames();
  if (result.migrated > 0) {
    console.log(`Migrated ${result.migrated} legacy Cast friendly name(s).`);
  }
}
