import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { migrateLegacyFriendlyNames } from '../migrate-friendly-name-options.mjs';
import { readFriendlyNameEntries, writeFriendlyNameEntries } from '../friendly-name-store.mjs';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'm1s-cast-name-migration-'));
const optionsPath = path.join(tempDirectory, 'options.json');
const namesPath = path.join(tempDirectory, 'names.json');

try {
  fs.writeFileSync(optionsPath, JSON.stringify({
    individual_friendly_names: [
      { entity_id: 'media_player.m1s_media_group', friendly_name: 'Toate vechi' },
      { entity_id: 'media_player.router_221', friendly_name: 'Balcon' }
    ]
  }));
  await writeFriendlyNameEntries([
    { entity_id: 'media_player.m1s_media_group', friendly_name: 'Toate noi' }
  ], null, namesPath);

  const result = await migrateLegacyFriendlyNames(optionsPath, namesPath);
  assert.equal(result.migrated, 2);
  assert.deepEqual(readFriendlyNameEntries(namesPath), [
    { entity_id: 'media_player.m1s_media_group', friendly_name: 'Toate noi' },
    { entity_id: 'media_player.router_221', friendly_name: 'Balcon' }
  ]);
} finally {
  if (tempDirectory.startsWith(os.tmpdir())) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

console.log('Friendly-name option migration tests passed.');
