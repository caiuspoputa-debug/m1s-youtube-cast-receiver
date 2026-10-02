import http from 'node:http';

import { castFriendlyName, friendlyNameBase } from './friendly-names.mjs';
import {
  FRIENDLY_NAMES_PATH,
  readFriendlyNameEntries,
  writeFriendlyNameEntries
} from './friendly-name-store.mjs';

const SETTINGS_PAGE = `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nume Cast M1S</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: var(--primary-background-color, #f7f7f7); color: var(--primary-text-color, #202124); }
    main { width: min(760px, calc(100% - 32px)); margin: 24px auto; }
    header { margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: 24px; font-weight: 600; }
    p { margin: 0; color: var(--secondary-text-color, #666); font-size: 14px; }
    .panel { background: var(--card-background-color, #fff); border: 1px solid var(--divider-color, #ddd); border-radius: 8px; overflow: hidden; }
    .row { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(240px, 1.35fr); gap: 18px; align-items: center; padding: 16px; border-bottom: 1px solid var(--divider-color, #e5e5e5); }
    .row:last-child { border-bottom: 0; }
    .identity { min-width: 0; }
    .label { font-size: 15px; font-weight: 600; }
    .entity { margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--secondary-text-color, #777); font: 12px ui-monospace, monospace; }
    .name-field { display: grid; grid-template-columns: 42px minmax(0, 1fr); align-items: stretch; }
    .prefix { display: grid; place-items: center; border: 1px solid var(--divider-color, #bbb); border-right: 0; border-radius: 6px 0 0 6px; background: var(--secondary-background-color, #eee); font-weight: 700; }
    input { min-width: 0; height: 42px; box-sizing: border-box; border: 1px solid var(--divider-color, #bbb); border-radius: 0 6px 6px 0; padding: 0 11px; background: var(--card-background-color, #fff); color: inherit; font: inherit; }
    input:focus { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -2px; }
    footer { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-top: 16px; }
    #status { margin-right: auto; font-size: 13px; color: var(--secondary-text-color, #666); }
    button { min-height: 42px; border: 0; border-radius: 6px; padding: 0 18px; background: var(--primary-color, #03a9f4); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: .55; cursor: default; }
    .error { color: var(--error-color, #db4437) !important; }
    @media (max-width: 620px) { .row { grid-template-columns: 1fr; gap: 10px; } main { width: min(100% - 20px, 760px); margin-top: 12px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Nume Cast M1S</h1>
      <p>Prefixul MP este fix. Numele salvate se aplică după repornirea add-on-ului.</p>
    </header>
    <section id="names" class="panel" aria-live="polite"></section>
    <footer>
      <span id="status"></span>
      <button id="save" type="button">Salvează numele</button>
    </footer>
  </main>
  <script>
    const root = document.getElementById('names');
    const status = document.getElementById('status');
    const save = document.getElementById('save');
    const currentPath = window.location.pathname;
    const basePath = currentPath.endsWith('/') ? currentPath : currentPath + '/';
    const endpoint = basePath + 'api/names';
    let items = [];

    function render() {
      root.replaceChildren();
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'row';

        const identity = document.createElement('div');
        identity.className = 'identity';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = item.kind === 'group' ? 'Grup M1S' : item.current_cast_name;
        const entity = document.createElement('div');
        entity.className = 'entity';
        entity.textContent = item.entity_id;
        identity.append(label, entity);

        const field = document.createElement('label');
        field.className = 'name-field';
        const prefix = document.createElement('span');
        prefix.className = 'prefix';
        prefix.textContent = 'MP';
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 64;
        input.value = item.friendly_name;
        input.dataset.entityId = item.entity_id;
        input.setAttribute('aria-label', 'Nume custom pentru ' + item.current_cast_name);
        field.append(prefix, input);

        row.append(identity, field);
        root.append(row);
      }
    }

    async function load() {
      status.textContent = 'Se încarcă...';
      const response = await fetch(endpoint, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Nu am putut citi receiverele.');
      const payload = await response.json();
      items = payload.items || [];
      render();
      status.textContent = items.length ? items.length + ' receivere detectate' : 'Niciun receiver detectat';
    }

    save.addEventListener('click', async () => {
      save.disabled = true;
      status.classList.remove('error');
      status.textContent = 'Se salvează...';
      const names = [...root.querySelectorAll('input')].map((input) => ({
        entity_id: input.dataset.entityId,
        friendly_name: input.value.trim()
      }));
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names })
        });
        if (!response.ok) throw new Error('Salvarea a eșuat.');
        const payload = await response.json();
        items = payload.items || items;
        render();
        status.textContent = 'Salvat. Repornește add-on-ul pentru aplicare.';
      } catch (error) {
        status.classList.add('error');
        status.textContent = error.message || 'Salvarea a eșuat.';
      } finally {
        save.disabled = false;
      }
    });

    load().catch((error) => {
      status.classList.add('error');
      status.textContent = error.message || 'Încărcarea a eșuat.';
    });
  </script>
</body>
</html>`;

function isIngressRequest(req) {
  const ingressPath = String(req.headers['x-ingress-path'] || '');
  return ingressPath.startsWith('/api/hassio_ingress/');
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, limit = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function responseItems(definitions, entries) {
  const saved = new Map(entries.map((item) => [item.entity_id.toLowerCase(), item.friendly_name]));
  return definitions.map((definition) => {
    const entityId = String(definition.entityId || '').toLowerCase();
    const base = friendlyNameBase(saved.get(entityId) || definition.name);
    return {
      entity_id: entityId,
      kind: definition.isGroup ? 'group' : 'individual',
      friendly_name: base,
      current_cast_name: castFriendlyName(base)
    };
  });
}

export function createFriendlyNameSettingsServer({
  getDefinitions,
  filePath = FRIENDLY_NAMES_PATH,
  logger = () => {}
}) {
  return http.createServer(async (req, res) => {
    const rawUrl = String(req.url || '/').replace(/^\/{2,}/, '/');
    const parsed = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    const route = parsed.pathname.replace(/\/{2,}/g, '/');
    const isPage = route === '/' || route === '/settings' || route === '/settings/';
    const isApi = route === '/api/names' || route === '/settings/api/names';

    if (!isPage && !isApi) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    if (!isIngressRequest(req)) {
      res.writeHead(403);
      res.end('Home Assistant Ingress required');
      return;
    }

    if (isPage && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(SETTINGS_PAGE);
      return;
    }

    const discovered = getDefinitions?.();
    const definitions = Array.isArray(discovered) ? discovered : [];
    if (isApi && req.method === 'GET') {
      sendJson(res, 200, {
        items: responseItems(definitions, readFriendlyNameEntries(filePath)),
        requires_restart: true
      });
      return;
    }

    if (isApi && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const allowed = new Set(definitions.map((item) => String(item.entityId || '').toLowerCase()));
        const entries = await writeFriendlyNameEntries(body?.names, allowed, filePath);
        logger('info', `Saved ${entries.length} custom Cast friendly name(s).`);
        sendJson(res, 200, {
          items: responseItems(definitions, entries),
          requires_restart: true
        });
      } catch (error) {
        logger('warn', 'Could not save Cast friendly names.', error?.message || String(error));
        sendJson(res, 400, { error: error?.message || 'Invalid request' });
      }
      return;
    }

    res.writeHead(405, { Allow: 'GET, POST' });
    res.end('Method not allowed');
  });
}
