import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { createFriendlyNameSettingsServer } from '../friendly-name-settings.mjs';
import { readFriendlyNameEntries } from '../friendly-name-store.mjs';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'm1s-cast-names-'));
const filePath = path.join(tempDirectory, 'names.json');
const definitions = [
  {
    entityId: 'media_player.m1s_media_group',
    name: 'MP Group',
    isGroup: true
  },
  {
    entityId: 'media_player.aqara_m1s_zigbee_router_192_168_0_221_media_player',
    name: 'MP Balcon',
    isGroup: false
  }
];
const server = createFriendlyNameSettingsServer({
  getDefinitions: () => definitions,
  filePath
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert.equal(typeof address, 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const ingressHeaders = { 'X-Ingress-Path': '/api/hassio_ingress/test-token' };

  const direct = await fetch(`${base}/settings`);
  assert.equal(direct.status, 403);

  const page = await fetch(`${base}/settings`, { headers: ingressHeaders });
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Prefixul MP este fix/);
  const pageScript = pageHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(pageScript, 'Settings page must contain its client script');
  assert.doesNotThrow(() => new vm.Script(pageScript), 'Settings page client script must compile');

  class FakeElement {
    constructor() {
      this.children = [];
      this.classList = { add() {}, remove() {} };
      this.dataset = {};
      this.textContent = '';
      this.value = '';
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    addEventListener() {}
    setAttribute() {}
  }
  const pageElements = {
    names: new FakeElement(),
    status: new FakeElement(),
    save: new FakeElement()
  };
  const browserContext = {
    window: { location: { pathname: '/api/hassio_ingress/test-token/settings' } },
    document: {
      getElementById: (id) => pageElements[id],
      createElement: () => new FakeElement()
    },
    fetch: async (endpoint) => {
      assert.equal(endpoint, '/api/hassio_ingress/test-token/settings/api/names');
      return {
        ok: true,
        json: async () => ({
          items: [
            { entity_id: 'media_player.m1s_media_group', kind: 'group', friendly_name: 'Group', current_cast_name: 'MP Group' },
            { entity_id: 'media_player.router_221', kind: 'individual', friendly_name: 'Balcon', current_cast_name: 'MP Balcon' }
          ]
        })
      };
    }
  };
  vm.runInNewContext(pageScript, browserContext);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pageElements.names.children.length, 2, 'Client script must render discovered receivers');
  assert.equal(pageElements.status.textContent, '2 receivere detectate');

  const duplicateSlashPage = await fetch(`${base}//settings`, { headers: ingressHeaders });
  assert.equal(duplicateSlashPage.status, 200);

  const rootPage = await fetch(`${base}/`, { headers: ingressHeaders });
  assert.equal(rootPage.status, 200);

  const initial = await fetch(`${base}/settings/api/names`, { headers: ingressHeaders });
  assert.equal(initial.status, 200);
  const initialPayload = await initial.json();
  assert.deepEqual(initialPayload.items.map((item) => item.friendly_name), ['Group', 'Balcon']);

  const rootApi = await fetch(`${base}/api/names`, { headers: ingressHeaders });
  assert.equal(rootApi.status, 200);

  const saved = await fetch(`${base}/settings/api/names`, {
    method: 'POST',
    headers: { ...ingressHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      names: [
        { entity_id: 'media_player.m1s_media_group', friendly_name: 'Toate' },
        {
          entity_id: 'media_player.aqara_m1s_zigbee_router_192_168_0_221_media_player',
          friendly_name: 'Terasă'
        },
        { entity_id: 'media_player.not_discovered', friendly_name: 'Ignored' }
      ]
    })
  });
  assert.equal(saved.status, 200);
  const savedPayload = await saved.json();
  assert.deepEqual(savedPayload.items.map((item) => item.current_cast_name), ['MP Toate', 'MP Terasă']);
  assert.deepEqual(readFriendlyNameEntries(filePath), [
    { entity_id: 'media_player.m1s_media_group', friendly_name: 'Toate' },
    {
      entity_id: 'media_player.aqara_m1s_zigbee_router_192_168_0_221_media_player',
      friendly_name: 'Terasă'
    }
  ]);
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (tempDirectory.startsWith(os.tmpdir())) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

console.log('Friendly-name settings UI tests passed.');
