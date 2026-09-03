import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import YouTubeCastReceiver, { Constants, Player } from 'yt-cast-receiver';

const OPTIONS_PATH = '/data/options.json';
const YTDLP = '/opt/yt-dlp/bin/yt-dlp';

function readOptions() {
  const raw = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
  return {
    targetEntity: String(raw.target_entity || 'media_player.m1s_media_group'),
    deviceName: String(raw.device_name || 'Aqara M1S Group'),
    audioPort: Number(raw.audio_port || 8098),
    dialPort: Number(raw.dial_port || 8099),
    streamHost: String(raw.stream_host || '').trim(),
    enableTvCode: raw.enable_tv_code !== false,
    includeIndividual: raw.include_individual !== false,
    individualMatch: String(raw.individual_match || 'aqara_m1s_zigbee_router').toLowerCase(),
    maxReceivers: Math.max(1, Number(raw.max_receivers || 16)),
    autoRemoveIndividualFromGroup: raw.auto_remove_individual_from_group !== false,
    autoRestoreIndividualToGroup: raw.auto_restore_individual_to_group !== false,
    autoRemoveGroupDelayMs: Math.max(0, Number(raw.auto_remove_group_delay_ms ?? 300)),
    logLevel: String(raw.log_level || 'info')
  };
}

const cfg = readOptions();
const supervisorToken = process.env.SUPERVISOR_TOKEN;
if (!supervisorToken) {
  throw new Error('SUPERVISOR_TOKEN is missing. Set homeassistant_api: true in config.yaml.');
}

function detectLanIPv4() {
  const candidates = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      candidates.push(item.address);
    }
  }
  const privateIp = candidates.find((ip) =>
    ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
  return privateIp || candidates[0] || null;
}

const streamHost = cfg.streamHost || detectLanIPv4();
if (!streamHost) {
  throw new Error('Could not determine LAN IPv4. Set stream_host in add-on configuration.');
}

function log(level, message, extra = '') {
  const order = { error: 0, warn: 1, info: 2, debug: 3 };
  if ((order[level] ?? 2) > (order[cfg.logLevel] ?? 2)) return;
  const suffix = extra ? ` ${extra}` : '';
  console.log(`[M1S-YT][${level.toUpperCase()}] ${message}${suffix}`);
}

async function haRequest(apiPath, { method = 'GET', body } = {}) {
  const response = await fetch(`http://supervisor/core/api${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${supervisorToken}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Home Assistant API ${method} ${apiPath} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
}

async function haDomainService(domain, service, data = {}) {
  return haRequest(`/services/${domain}/${service}`, {
    method: 'POST',
    body: data
  });
}

async function haService(targetEntity, service, data = {}) {
  return haDomainService('media_player', service, { entity_id: targetEntity, ...data });
}

async function switchTurnOff(entityId) {
  return haDomainService('switch', 'turn_off', { entity_id: entityId });
}

async function switchTurnOn(entityId) {
  return haDomainService('switch', 'turn_on', { entity_id: entityId });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function safeVideoId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : null;
}

function safeKey(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return key.slice(0, 80) || 'receiver';
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (m) => m.toUpperCase());
}

function receiverNameFromState(state) {
  const attrs = state?.attributes || {};
  let value = String(attrs.friendly_name || '');
  value = value
    .replace(/aqara\s*m1s\s*zigbee\s*router/ig, ' ')
    .replace(/\bmedia\s*player\b/ig, ' ')
    .replace(/\bradio\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) {
    value = String(state?.entity_id || '')
      .replace(/^media_player\./, '')
      .replace(/aqara_m1s_zigbee_router/ig, '_')
      .replace(/_radio$/i, '')
      .replace(/_media_player$/i, '')
      .replace(/^_+|_+$/g, '');
  }

  const pretty = titleCase(value) || String(state?.entity_id || 'M1S');
  return /^m1s\b/i.test(pretty) ? pretty : `M1S ${pretty}`;
}

const INCLUDE_SWITCH_SUFFIX = '_include_in_m1s_media_group';
const GENERIC_ENTITY_TOKENS = new Set([
  'aqara', 'm1s', 'zigbee', 'router', 'media', 'player', 'radio',
  'include', 'in', 'group', 'si', 'de'
]);

function mediaBaseFromEntityId(entityId) {
  return String(entityId || '')
    .toLowerCase()
    .replace(/^media_player\./, '')
    .replace(/_(media_player|radio)$/i, '');
}

function includeSwitchBaseFromEntityId(entityId) {
  return String(entityId || '')
    .toLowerCase()
    .replace(/^switch\./, '')
    .replace(new RegExp(`${INCLUDE_SWITCH_SUFFIX}$`, 'i'), '');
}

function meaningfulEntityTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !GENERIC_ENTITY_TOKENS.has(token));
}

function scoreIncludeSwitch(mediaBase, switchBase) {
  if (!mediaBase || !switchBase) return 0;
  if (switchBase === mediaBase) return 1000;
  if (switchBase.includes(mediaBase) || mediaBase.includes(switchBase)) return 500;

  const mediaTokens = meaningfulEntityTokens(mediaBase);
  const switchTokens = new Set(meaningfulEntityTokens(switchBase));
  let score = 0;
  for (const token of mediaTokens) {
    if (switchTokens.has(token)) score += 10;
  }
  return score;
}

function findIncludeSwitchForMediaPlayer(mediaEntityId, states) {
  const mediaBase = mediaBaseFromEntityId(mediaEntityId);
  const expectedEntityId = `switch.${mediaBase}${INCLUDE_SWITCH_SUFFIX}`;
  const switchStates = (Array.isArray(states) ? states : []).filter((state) => {
    const entityId = String(state?.entity_id || '').toLowerCase();
    return entityId.startsWith('switch.') && entityId.endsWith(INCLUDE_SWITCH_SUFFIX);
  });

  const exact = switchStates.find((state) => String(state.entity_id).toLowerCase() === expectedEntityId);
  if (exact) return String(exact.entity_id);

  const ranked = switchStates
    .map((state) => ({
      entityId: String(state.entity_id),
      score: scoreIncludeSwitch(mediaBase, includeSwitchBaseFromEntityId(state.entity_id))
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entityId.localeCompare(b.entityId));

  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    log('debug', `Ambiguous include switch for ${mediaEntityId}; leaving auto-remove disabled for this receiver.`);
    return null;
  }
  return ranked[0].entityId;
}

async function discoverReceiverDefinitions() {
  const defs = [{
    key: 'group',
    entityId: cfg.targetEntity,
    name: cfg.deviceName,
    port: cfg.dialPort,
    isGroup: true
  }];

  if (!cfg.includeIndividual || defs.length >= cfg.maxReceivers) return defs;

  let states;
  try {
    states = await haRequest('/states');
  } catch (error) {
    log('warn', 'Could not discover individual M1S media players; group receiver only.', error.message);
    return defs;
  }

  const candidates = (Array.isArray(states) ? states : [])
    .filter((state) => {
      const entityId = String(state?.entity_id || '');
      if (!entityId.startsWith('media_player.')) return false;
      if (entityId === cfg.targetEntity) return false;
      const friendly = String(state?.attributes?.friendly_name || '');
      return `${entityId} ${friendly}`.toLowerCase().includes(cfg.individualMatch);
    })
    .sort((a, b) => receiverNameFromState(a).localeCompare(receiverNameFromState(b)));

  const usedNames = new Set([cfg.deviceName.toLowerCase()]);
  let index = 1;
  for (const state of candidates) {
    if (defs.length >= cfg.maxReceivers) break;
    const entityId = String(state.entity_id);
    let name = receiverNameFromState(state);
    if (usedNames.has(name.toLowerCase())) {
      name = `${name} ${index}`;
    }
    usedNames.add(name.toLowerCase());
    defs.push({
      key: safeKey(entityId.replace(/^media_player\./, '')),
      entityId,
      name,
      port: cfg.dialPort + index,
      isGroup: false,
      includeSwitchEntity: findIncludeSwitchForMediaPlayer(entityId, states)
    });
    index += 1;
  }

  return defs;
}

class JsonDataStore {
  constructor(key) {
    this.file = path.join('/data', `ytcr_${safeKey(key)}.json`);
    this.logger = null;
    this.data = {};
    this.writeChain = Promise.resolve();
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
      }
    } catch (error) {
      this.data = {};
      log('warn', `Could not read datastore ${this.file}; starting fresh.`, error.message);
    }
  }

  setLogger(logger) {
    this.logger = logger;
  }

  async get(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
  }

  async set(key, value) {
    this.data[key] = value;
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(this.data), 'utf8');
      await fs.promises.rename(tmp, this.file);
    }).catch((error) => {
      log('warn', `Datastore write failed for ${this.file}.`, error.message);
    });
    return this.writeChain;
  }

  async clear() {
    this.data = {};
    try { await fs.promises.unlink(this.file); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

const metadataCache = new Map();
const quickTitleCache = new Map();

async function getQuickYouTubeTitle(videoId, timeoutMs = 1200) {
  const cached = quickTitleCache.get(videoId);
  if (cached) return cached;

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
      const response = await fetch(endpoint, { signal: controller.signal });
      if (!response.ok) throw new Error(`YouTube oEmbed -> ${response.status}`);
      const data = await response.json();
      const title = typeof data?.title === 'string' ? data.title.trim() : '';
      if (!title) throw new Error('YouTube oEmbed returned no title');
      return title;
    } finally {
      clearTimeout(timer);
    }
  })();

  quickTitleCache.set(videoId, promise);
  try {
    const title = await promise;
    quickTitleCache.set(videoId, Promise.resolve(title));
    return title;
  } catch (error) {
    quickTitleCache.delete(videoId);
    throw error;
  }
}

function runYtDlpJson(videoId) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json', '--skip-download', '--no-playlist',
      '--quiet', '--no-warnings', '--js-runtimes', 'node',
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      if (out.length < 8 * 1024 * 1024) out += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (err.length < 64 * 1024) err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp metadata failed (${code}): ${err.trim().slice(-1200)}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(new Error(`yt-dlp returned invalid metadata JSON: ${error.message}`));
      }
    });
  });
}

function getMetadata(videoId) {
  const cached = metadataCache.get(videoId);
  if (cached) return cached;
  const promise = runYtDlpJson(videoId)
    .then((data) => {
      metadataCache.set(videoId, Promise.resolve(data));
      return data;
    })
    .catch((error) => {
      metadataCache.delete(videoId);
      throw error;
    });
  metadataCache.set(videoId, promise);
  return promise;
}

let streamSerial = 0;
const runtimePlayersByKey = new Map();
let receiverDefinitions = [];
let receiverDefinitionsByKey = new Map();

const PCM_RATE = 32000;
const PCM_CHANNELS = 1;
const PCM_SAMPLE_BYTES = 4;
const PCM_BYTES_PER_SECOND = PCM_RATE * PCM_CHANNELS * PCM_SAMPLE_BYTES;
const PCM_CHUNK_SECONDS = 0.035;
const PCM_CHUNK_BYTES = Math.round(PCM_BYTES_PER_SECOND * PCM_CHUNK_SECONDS);
const CONTINUOUS_QUEUE_SECONDS = 2.50;
const CONTINUOUS_QUEUE_CHUNKS = Math.max(8, Math.round(CONTINUOUS_QUEUE_SECONDS / PCM_CHUNK_SECONDS));
const CONTINUOUS_RETRY_LIMIT = 2;

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createStreamingWavHeader() {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(0xffffffff, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(PCM_RATE, 24);
  header.writeUInt32LE(PCM_BYTES_PER_SECOND, 28);
  header.writeUInt16LE(PCM_CHANNELS * PCM_SAMPLE_BYTES, 32);
  header.writeUInt16LE(PCM_SAMPLE_BYTES * 8, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(0xffffffff, 40);
  return header;
}

function waitForDrain(stream) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('close', onClose);
      stream.off('error', onError);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('audio HTTP client closed')); };
    const onError = (error) => { cleanup(); reject(error); };
    stream.once('drain', onDrain);
    stream.once('close', onClose);
    stream.once('error', onError);
  });
}

class ContinuousAudioSession {
  constructor(player, serial) {
    this.player = player;
    this.definition = player.definition;
    this.serial = serial;
    this.url = `http://${streamHost}:${cfg.audioPort}/stream/${encodeURIComponent(this.definition.key)}/${serial}.wav`;
    this.active = true;
    this.paused = false;
    this.response = null;
    this.outputTask = null;
    this.sourceTasks = new Set();
    this.sourceChildren = new Set();
    this.trackGeneration = 0;
    this.currentTrackGeneration = 0;
    this.queue = [];
    this.queueWaiters = [];
    this.spaceWaiters = [];
    this.clientReady = createDeferred();
    this.trackOutputStarts = new Map();
    this.trackOutputDrains = new Map();
    this.decodedEofGenerations = new Set();
    this.firstPcmOutputAt = null;
    this.transportLeadMs = null;
    this.outputStarted = false;
    this.nextDeadline = null;
  }

  expectedPath() {
    return `/stream/${encodeURIComponent(this.definition.key)}/${this.serial}.wav`;
  }

  setTransportLeadMs(value) {
    const lead = Math.max(0, Math.min(10000, Number(value) || 0));
    this.transportLeadMs = lead;
    log('info', `[${this.definition.name}] Continuous transport lead measured: ${(lead / 1000).toFixed(3)}s.`);
  }

  _wakeQueue() {
    const waiters = this.queueWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  _wakeSpace() {
    const waiters = this.spaceWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  async _waitForQueue() {
    if (this.queue.length || !this.active) return;
    await new Promise((resolve) => this.queueWaiters.push(resolve));
  }

  async _waitForSpace(generation) {
    while (this.active && generation === this.currentTrackGeneration && this.queue.length >= CONTINUOUS_QUEUE_CHUNKS) {
      await new Promise((resolve) => this.spaceWaiters.push(resolve));
    }
  }

  _discardQueuedAudio() {
    this.queue.length = 0;
    this._wakeSpace();
  }

  _killSourceChildren() {
    for (const child of this.sourceChildren) {
      if (child && !child.killed) {
        try { child.kill('SIGTERM'); } catch (_) {}
      }
    }
    this.sourceChildren.clear();
  }

  async attachResponse(res) {
    if (!this.active) {
      res.writeHead(404, { 'Connection': 'close' });
      res.end('Session ended');
      return;
    }

    if (this.response && this.response !== res && !this.response.destroyed) {
      try { this.response.destroy(); } catch (_) {}
    }
    this.response = res;
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-M1S-YT-Stream-Serial': String(this.serial),
      'X-M1S-YT-Continuous': '1'
    });
    res.write(createStreamingWavHeader());
    this.clientReady.resolve();

    res.on('close', () => {
      if (this.response === res) {
        this.response = null;
        if (this.active) {
          log('warn', `[${this.definition.name}] Continuous audio HTTP client disconnected; waiting for transport reconnect.`);
          this.clientReady = createDeferred();
        }
      }
    });

    if (!this.outputTask) {
      this.outputTask = this._outputLoop().catch((error) => {
        if (this.active) log('error', `[${this.definition.name}] Continuous output loop failed.`, error?.message || String(error));
      });
    }
  }

  async _writeChunk(chunk) {
    while (this.active) {
      if (!this.response || this.response.destroyed || this.response.writableEnded) {
        await this.clientReady.promise;
        continue;
      }
      const ok = this.response.write(chunk);
      if (!ok) await waitForDrain(this.response);
      return;
    }
  }

  async _pace() {
    const now = Date.now();
    if (this.nextDeadline === null) this.nextDeadline = now;
    const delay = this.nextDeadline - now;
    if (delay > 0) await sleep(delay);
    const after = Date.now();
    if (after - this.nextDeadline > 1000) this.nextDeadline = after;
    this.nextDeadline += Math.round(PCM_CHUNK_SECONDS * 1000);
  }

  async _outputLoop() {
    await this.clientReady.promise;

    // Initial start is deliberately real PCM only. No leading synthetic silence:
    // HA builds its normal one-time YTM prebuffer from actual music, then exposes
    // ytm_transport_started_serial for clock alignment.
    while (this.active && !this.queue.length) await this._waitForQueue();
    if (!this.active) return;

    while (this.active) {
      if (!this.response || this.response.destroyed || this.response.writableEnded) {
        await this.clientReady.promise;
        this.nextDeadline = null;
        continue;
      }

      let item = null;
      if (this.queue.length) {
        item = this.queue.shift();
        this._wakeSpace();
      }

      // After the first track has started, keep the transport alive at all times.
      // A short yt-dlp startup gap becomes PCM silence inside the SAME stream;
      // HA never sees EOF and therefore never re-buffers or restarts between songs.
      const chunk = item?.chunk || Buffer.alloc(PCM_CHUNK_BYTES);
      await this._pace();
      const outputAt = Date.now();
      await this._writeChunk(chunk);

      if (item) {
        if (this.firstPcmOutputAt === null) this.firstPcmOutputAt = outputAt;
        const deferred = this.trackOutputStarts.get(item.generation);
        if (deferred && !deferred.started) {
          deferred.started = true;
          deferred.resolve(outputAt);
        }
        if (this.decodedEofGenerations.has(item.generation)
            && !this.queue.some((queued) => queued.generation === item.generation)) {
          const drained = this.trackOutputDrains.get(item.generation);
          if (drained && !drained.done) {
            drained.done = true;
            drained.resolve(outputAt);
          }
        }
      }
    }
  }

  async waitTrackOutputStart(generation, timeoutMs = 15000) {
    const deferred = this.trackOutputStarts.get(generation);
    if (!deferred) throw new Error(`unknown continuous track generation ${generation}`);
    let timer;
    try {
      return await Promise.race([
        deferred.promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('continuous track PCM start timeout')), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async waitTrackOutputDrain(generation, timeoutMs = 15000) {
    const deferred = this.trackOutputDrains.get(generation);
    if (!deferred) throw new Error(`unknown continuous track drain generation ${generation}`);
    let timer;
    try {
      return await Promise.race([
        deferred.promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('continuous track drain timeout')), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async queueTrack(videoId, position = 0, { append = false } = {}) {
    if (!this.active) throw new Error('continuous audio session is not active');
    const id = safeVideoId(videoId);
    if (!id) throw new Error(`invalid video id: ${videoId}`);

    this.paused = false;
    this.trackGeneration += 1;
    const generation = this.trackGeneration;
    this.currentTrackGeneration = generation;
    const deferred = createDeferred();
    deferred.started = false;
    this.trackOutputStarts.set(generation, deferred);
    const drained = createDeferred();
    drained.done = false;
    this.trackOutputDrains.set(generation, drained);
    this.decodedEofGenerations.delete(generation);

    if (!append) {
      this._killSourceChildren();
      this._discardQueuedAudio();
    }

    const task = this._decodeTrack({
      videoId: id,
      position: Math.max(0, Number(position) || 0),
      generation
    }).catch((error) => {
      if (this.active && generation === this.currentTrackGeneration) {
        log('error', `[${this.definition.name}] Continuous track decode failed: ${id}`, error?.message || String(error));
      }
    }).finally(() => this.sourceTasks.delete(task));
    this.sourceTasks.add(task);
    return generation;
  }

  async _enqueueChunk(generation, chunk) {
    await this._waitForSpace(generation);
    if (!this.active || generation !== this.currentTrackGeneration) return false;
    this.queue.push({ generation, chunk });
    this._wakeQueue();
    return true;
  }

  async _decodeTrack(track) {
    const { videoId, generation } = track;
    let resumePosition = track.position;

    for (let attempt = 0; attempt <= CONTINUOUS_RETRY_LIMIT; attempt += 1) {
      if (!this.active || generation !== this.currentTrackGeneration || this.paused) return;
      const startedPcmBytes = this.queue
        .filter((item) => item.generation === generation)
        .reduce((sum, item) => sum + item.chunk.length, 0);
      const result = await this._decodeTrackAttempt(videoId, resumePosition, generation);
      if (result === 'cancelled') return;
      if (result === 'eof') {
        if (!this.active || generation !== this.currentTrackGeneration || this.paused) return;
        this.decodedEofGenerations.add(generation);
        if (!this.queue.some((queued) => queued.generation === generation)) {
          const drained = this.trackOutputDrains.get(generation);
          if (drained && !drained.done) { drained.done = true; drained.resolve(Date.now()); }
        }
        log('info', `[${this.definition.name}] Track source EOF: ${videoId}; advancing queue inside continuous stream.`);
        void this.player.handleContinuousSourceEof(videoId, generation);
        return;
      }
      if (attempt >= CONTINUOUS_RETRY_LIMIT) {
        throw new Error(`source failed after ${CONTINUOUS_RETRY_LIMIT + 1} attempt(s)`);
      }
      const queuedNow = this.queue
        .filter((item) => item.generation === generation)
        .reduce((sum, item) => sum + item.chunk.length, 0);
      const emittedEstimate = Math.max(0, queuedNow - startedPcmBytes) / PCM_BYTES_PER_SECOND;
      resumePosition += emittedEstimate;
      log('warn', `[${this.definition.name}] Retrying current track source without restarting HA.`, `${videoId} attempt=${attempt + 2}`);
      await sleep(350 * (attempt + 1));
    }
  }

  _spawnTrackProcesses(videoId, position) {
    const ytdlpArgs = [
      '--no-playlist', '--quiet', '--no-warnings', '--js-runtimes', 'node',
      '-f', 'bestaudio[ext=webm]/bestaudio', '-o', '-'
    ];
    if (position > 0.5) ytdlpArgs.push('--download-sections', `*${position}-`);
    ytdlpArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

    const ytdlp = spawn(YTDLP, ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const ffmpeg = spawn('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'warning',
      '-i', 'pipe:0', '-vn',
      '-ac', String(PCM_CHANNELS), '-ar', String(PCM_RATE),
      '-c:a', 'pcm_s32le', '-f', 's32le', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.sourceChildren.add(ytdlp);
    this.sourceChildren.add(ffmpeg);
    ytdlp.stdout.pipe(ffmpeg.stdin);
    return { ytdlp, ffmpeg };
  }

  async _decodeTrackAttempt(videoId, position, generation) {
    const { ytdlp, ffmpeg } = this._spawnTrackProcesses(videoId, position);
    let ytdlpErr = '';
    let ffmpegErr = '';
    ytdlp.stderr.on('data', (chunk) => { if (ytdlpErr.length < 65536) ytdlpErr += chunk.toString(); });
    ffmpeg.stderr.on('data', (chunk) => { if (ffmpegErr.length < 65536) ffmpegErr += chunk.toString(); });

    const ytClose = new Promise((resolve) => ytdlp.once('close', resolve));
    const ffClose = new Promise((resolve) => ffmpeg.once('close', resolve));
    ytdlp.stdin?.on?.('error', () => {});
    ffmpeg.stdin?.on?.('error', () => {});

    let buffer = Buffer.alloc(0);
    let lastFullChunk = null;
    try {
      for await (const data of ffmpeg.stdout) {
        if (!this.active || generation !== this.currentTrackGeneration || this.paused) return 'cancelled';
        buffer = buffer.length ? Buffer.concat([buffer, data]) : Buffer.from(data);
        while (buffer.length >= PCM_CHUNK_BYTES) {
          const full = buffer.subarray(0, PCM_CHUNK_BYTES);
          buffer = buffer.subarray(PCM_CHUNK_BYTES);
          // Keep one final period in hand until EOF so source completion is not
          // announced ahead of the last real PCM period.
          if (lastFullChunk) {
            if (!(await this._enqueueChunk(generation, lastFullChunk))) return 'cancelled';
          }
          lastFullChunk = Buffer.from(full);
        }
      }

      if (!this.active || generation !== this.currentTrackGeneration || this.paused) return 'cancelled';
      if (buffer.length) {
        const padded = Buffer.alloc(PCM_CHUNK_BYTES);
        buffer.copy(padded);
        if (lastFullChunk) {
          if (!(await this._enqueueChunk(generation, lastFullChunk))) return 'cancelled';
        }
        lastFullChunk = padded;
      }
      if (lastFullChunk) {
        if (!(await this._enqueueChunk(generation, lastFullChunk))) return 'cancelled';
      }

      const [ytCode, ffCode] = await Promise.all([ytClose, ffClose]);
      this.sourceChildren.delete(ytdlp);
      this.sourceChildren.delete(ffmpeg);

      if (!this.active || generation !== this.currentTrackGeneration || this.paused) return 'cancelled';
      if ((ytCode === 0 || ytCode === null) && (ffCode === 0 || ffCode === null)) return 'eof';
      log('warn', `[${this.definition.name}] Source process ended unexpectedly.`,
        `yt-dlp=${ytCode} ffmpeg=${ffCode} ${(ytdlpErr || ffmpegErr).trim().slice(-700)}`);
      return 'failed';
    } finally {
      this.sourceChildren.delete(ytdlp);
      this.sourceChildren.delete(ffmpeg);
      if (!ytdlp.killed && ytdlp.exitCode === null) { try { ytdlp.kill('SIGTERM'); } catch (_) {} }
      if (!ffmpeg.killed && ffmpeg.exitCode === null) { try { ffmpeg.kill('SIGTERM'); } catch (_) {} }
    }
  }

  pause() {
    if (!this.active) return;
    this.paused = true;
    this.trackGeneration += 1;
    this.currentTrackGeneration = this.trackGeneration;
    this._killSourceChildren();
    this._discardQueuedAudio();
    log('info', `[${this.definition.name}] Continuous stream paused; HA transport kept alive with silence.`);
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    this.paused = false;
    this.trackGeneration += 1;
    this.currentTrackGeneration = this.trackGeneration;
    this._killSourceChildren();
    this._discardQueuedAudio();
    this._wakeQueue();
    this.clientReady.resolve();
    if (this.response && !this.response.writableEnded) {
      try { this.response.end(); } catch (_) {}
    }
    this.response = null;
    log('info', `[${this.definition.name}] Continuous YT/YTM transport closed.`);
  }
}

function nextStreamSerial() {
  streamSerial += 1;
  return streamSerial;
}

const audioServer = http.createServer((req, res) => {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      architecture: 'continuous_pcm_session',
      receivers: receiverDefinitions.map((item) => ({ name: item.name, entity_id: item.entityId, port: item.port }))
    }));
    return;
  }
  if (parsed.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`M1S YouTube Cast Receiver - continuous PCM\nReceivers: ${receiverDefinitions.length}\n`);
    return;
  }

  const match = parsed.pathname.match(/^\/stream\/([A-Za-z0-9_-]{1,80})\/(\d+)\.wav$/);
  if (!match) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const receiverKey = safeKey(match[1]);
  const serial = Number(match[2]);
  const player = runtimePlayersByKey.get(receiverKey);
  const session = player?.continuousSession;
  if (!player || !session || !session.active || session.serial !== serial) {
    res.writeHead(404, { 'Connection': 'close' });
    res.end('Unknown continuous session');
    return;
  }
  log('info', `[${player.definition.name}] Continuous audio transport connected.`, `session=${serial}`);
  void session.attachResponse(res);
});

class M1SPlayer extends Player {
  constructor(definition) {
    super();
    this.definition = definition;
    this.currentVideo = null;
    this.currentVideoId = null;
    this.title = null;
    this.duration = 0;
    this.basePosition = 0;
    this.startedAt = null;
    this.paused = false;
    this.volume = { level: 50, muted: false };
    this.playGeneration = 0;
    this.continuousSession = null;
    this.naturalAdvanceInProgress = false;
    this.preserveTransportAcrossStop = false;
    this.ownershipMonitor = null;

    // Sender ownership is tracked by yt-cast-receiver Sender.id. This is a
    // per-sender/device identifier; do not use Gaia/account ids here because
    // two different phones may use the same Google account.
    this.connectedSenderIds = new Set();
    this.lastConnectedSenderId = null;
    this.sessionSenderId = null;

    // Group-only barrier used when the SAME sender moves from an individual
    // receiver to the M1S Media Group. The individual must Stop + restore its
    // original group membership before group playback starts.
    this.pendingGroupSenderRestore = Promise.resolve();

    // Exact v0.3.7 individual-group session memory. Capture once before the
    // first automatic removal and never overwrite it on next/seek/resume.
    this.groupMembershipCaptured = false;
    this.wasInGroupBeforeYoutube = false;

    // Ownership guard: once HA switches to Radio / another source, the old
    // YT/YTM session may no longer control that media_player.
    this.ownsTarget = false;
    this.sessionRelinquished = false;
    this.relinquishInProgress = false;
  }

  currentPosition() {
    if (this.startedAt === null || this.paused) return this.basePosition;
    return Math.max(0, this.basePosition + (Date.now() - this.startedAt) / 1000);
  }

  noteSenderConnected(sender) {
    const senderId = String(sender?.id || '').trim();
    if (!senderId) return;
    this.connectedSenderIds.add(senderId);
    this.lastConnectedSenderId = senderId;
  }

  noteSenderDisconnected(sender) {
    const senderId = String(sender?.id || '').trim();
    if (!senderId) return;
    this.connectedSenderIds.delete(senderId);
    if (this.lastConnectedSenderId === senderId) {
      this.lastConnectedSenderId = this.connectedSenderIds.size === 1
        ? this.connectedSenderIds.values().next().value
        : null;
    }
    // Do NOT clear sessionSenderId here. An implicit disconnect is deliberately
    // allowed to keep playing; the same sender may immediately connect to the
    // Group, where 1.0.2 needs to identify the active individual session.
  }

  captureSessionSenderForStart() {
    if (this.definition.isGroup || this.sessionSenderId) return;
    const senderId = this.lastConnectedSenderId
      || (this.connectedSenderIds.size === 1 ? this.connectedSenderIds.values().next().value : null);
    if (!senderId) {
      log('warn', `[${this.definition.name}] Could not identify sender for individual YT/YTM session; same-phone Group restore will be unavailable for this session.`);
      return;
    }
    this.sessionSenderId = senderId;
    log('debug', `[${this.definition.name}] Individual YT/YTM session sender captured.`, `sender=${senderId}`);
  }

  queueSameSenderIndividualRestoreForGroup(sender) {
    if (!this.definition.isGroup) return;
    const senderId = String(sender?.id || '').trim();
    if (!senderId) return;

    const matchingPlayers = [...runtimePlayersByKey.values()].filter((candidate) =>
      candidate !== this
      && !candidate.definition.isGroup
      && candidate.sessionSenderId === senderId
      && candidate.continuousSession?.active
    );
    if (!matchingPlayers.length) return;

    const restoreWork = async () => {
      for (const candidate of matchingPlayers) {
        // This rule is intentionally ONLY Individual -> Group for the SAME
        // sender. Individual -> Individual is left untouched, and sessions
        // owned by a different phone/sender are never stopped here.
        log('info', `[${this.definition.name}] Same sender moved Individual -> Group; stopping ${candidate.definition.name} and restoring its original group membership when applicable before Group playback.`, `sender=${senderId}`);
        try {
          await candidate.stop();
        } catch (error) {
          log('warn', `[${this.definition.name}] Same-sender restore failed for ${candidate.definition.name}.`, error?.message || String(error));
        }
      }
    };

    // Chain handoffs so multiple matching individuals cannot race each other.
    this.pendingGroupSenderRestore = this.pendingGroupSenderRestore.then(restoreWork, restoreWork);
  }

  async waitForPendingGroupSenderRestore() {
    if (!this.definition.isGroup) return;
    await this.pendingGroupSenderRestore;
  }

  expectedStreamPath() {
    return this.continuousSession?.active ? this.continuousSession.expectedPath() : null;
  }

  async readTargetPlaybackState() {
    const state = await haRequest(`/states/${encodeURIComponent(this.definition.entityId)}`);
    const attrs = state?.attributes || {};
    const health = attrs.member_receiver_health && typeof attrs.member_receiver_health === 'object'
      ? attrs.member_receiver_health
      : {};
    let maxAlsaDelaySeconds = 0;
    for (const item of Object.values(health)) {
      const frames = Number(item?.alsa_delay_frames);
      if (Number.isFinite(frames) && frames > 0) {
        maxAlsaDelaySeconds = Math.max(maxAlsaDelaySeconds, frames / PCM_RATE);
      }
    }
    return {
      state: String(state?.state || '').toLowerCase(),
      mediaId: String(attrs.media_content_id || attrs.media_content_url || attrs.last_media_id || ''),
      transportStartedSerial: Number(attrs.ytm_transport_started_serial),
      groupPrebufferSeconds: Number(attrs.group_prebuffer_seconds || 0) || 0,
      remotePrefillSeconds: Number(attrs.group_remote_prefill_seconds || 0) || 0,
      singlePrebufferSeconds: (Number(attrs.single_prebuffer_ms || 0) || 0) / 1000,
      singleRemotePrefillSeconds: (Number(attrs.single_remote_prefill_ms || 0) || 0) / 1000,
      maxAlsaDelaySeconds
    };
  }

  startOwnershipMonitor() {
    if (this.ownershipMonitor) this.ownershipMonitor.cancelled = true;
    const token = { cancelled: false };
    this.ownershipMonitor = token;
    void (async () => {
      while (!token.cancelled && this.continuousSession?.active && this.ownsTarget && !this.sessionRelinquished) {
        try {
          const expectedPath = this.expectedStreamPath();
          const snapshot = await this.readTargetPlaybackState();
          if (expectedPath && snapshot.mediaId && !snapshot.mediaId.includes(expectedPath)) {
            await this.relinquishToExternalSource('HA source changed away from continuous YT/YTM session');
            return;
          }
        } catch (_) {}
        await sleep(500);
      }
    })().finally(() => {
      if (this.ownershipMonitor === token) this.ownershipMonitor = null;
    });
  }

  stopOwnershipMonitor() {
    if (this.ownershipMonitor) {
      this.ownershipMonitor.cancelled = true;
      this.ownershipMonitor = null;
    }
  }

  async targetStillOwnedByYoutube() {
    if (!this.ownsTarget || this.sessionRelinquished) return false;
    const expectedPath = this.expectedStreamPath();
    if (!expectedPath) return this.ownsTarget;
    try {
      const snapshot = await this.readTargetPlaybackState();
      if (snapshot.mediaId && !snapshot.mediaId.includes(expectedPath)) return false;
      return true;
    } catch (_) {
      return this.ownsTarget;
    }
  }

  async waitUntilTargetStopped(expectedPath, timeoutMs = 3000) {
    const deadline = Date.now() + Math.max(100, timeoutMs);
    while (Date.now() < deadline) {
      try {
        const snapshot = await this.readTargetPlaybackState();
        const active = snapshot.state === 'playing' || snapshot.state === 'buffering';
        if (!active) return true;
        if (expectedPath && snapshot.mediaId && !snapshot.mediaId.includes(expectedPath)) return true;
      } catch (_) {}
      await sleep(75);
    }
    return false;
  }

  async waitForTransportStarted(serial, timeoutMs = 15000) {
    const deadline = Date.now() + Math.max(1000, timeoutMs);
    let lastSnapshot = null;
    while (Date.now() < deadline) {
      try {
        const snapshot = await this.readTargetPlaybackState();
        lastSnapshot = snapshot;
        if (Number.isFinite(snapshot.transportStartedSerial)
            && snapshot.transportStartedSerial === serial) {
          return { at: Date.now(), snapshot, exact: true };
        }
        const expectedPath = this.expectedStreamPath();
        if (expectedPath && snapshot.mediaId && !snapshot.mediaId.includes(expectedPath)) {
          throw new Error('HA source changed before YT/YTM transport start');
        }
      } catch (error) {
        if (String(error?.message || '').includes('source changed')) throw error;
      }
      await sleep(100);
    }

    // Compatibility fallback for an integration without the transport-start
    // serial. It is used only once per Cast session, never at song boundaries.
    const snapshot = lastSnapshot || await this.readTargetPlaybackState();
    const configuredLeadSeconds = this.definition.isGroup
      ? Math.max(snapshot.groupPrebufferSeconds || 0, 2.5)
      : Math.max(snapshot.singlePrebufferSeconds || 0, 2.5);
    return {
      at: Date.now(),
      snapshot,
      exact: false,
      fallbackLeadMs: Math.round(configuredLeadSeconds * 1000)
    };
  }

  async relinquishToExternalSource(reason) {
    if (this.relinquishInProgress || this.sessionRelinquished) return;
    this.relinquishInProgress = true;
    this.sessionRelinquished = true;
    this.ownsTarget = false;
    try {
      log('info', `[${this.definition.name}] Relinquishing continuous YT/YTM ownership.`, reason || 'external HA source takeover');
      await this.stop();
    } catch (error) {
      log('warn', `[${this.definition.name}] Could not publish STOP after external source takeover.`, error?.message || String(error));
    } finally {
      this.relinquishInProgress = false;
    }
  }

  async captureGroupMembershipForYoutubeSession() {
    if (this.groupMembershipCaptured || this.definition.isGroup || !this.definition.includeSwitchEntity) return;
    this.groupMembershipCaptured = true;
    this.wasInGroupBeforeYoutube = false;
    const switchEntity = this.definition.includeSwitchEntity;
    try {
      const state = await haRequest(`/states/${encodeURIComponent(switchEntity)}`);
      this.wasInGroupBeforeYoutube = String(state?.state || '').toLowerCase() === 'on';
      log('info', `[${this.definition.name}] Group membership before YouTube session: ${this.wasInGroupBeforeYoutube ? 'in group' : 'outside group'}.`, switchEntity);
    } catch (error) {
      log('warn', `[${this.definition.name}] Could not read group membership before YouTube session; automatic restore will be skipped.`, error?.message || String(error));
    }
  }

  async ensureIndividualReadyForPlayback() {
    if (!cfg.autoRemoveIndividualFromGroup || this.definition.isGroup || !this.definition.includeSwitchEntity) return;
    await this.captureGroupMembershipForYoutubeSession();
    try {
      log('info', `[${this.definition.name}] Removing individual player from M1S group before YT/YTM session.`, this.definition.includeSwitchEntity);
      await switchTurnOff(this.definition.includeSwitchEntity);
      await sleep(cfg.autoRemoveGroupDelayMs);
    } catch (error) {
      log('warn', `[${this.definition.name}] Could not remove player from M1S group before playback.`, error?.message || String(error));
    }
  }

  async restoreIndividualGroupAfterStop(allowRestore = true) {
    const shouldRestore = allowRestore
      && cfg.autoRestoreIndividualToGroup
      && !this.definition.isGroup
      && Boolean(this.definition.includeSwitchEntity)
      && this.groupMembershipCaptured
      && this.wasInGroupBeforeYoutube;
    const switchEntity = this.definition.includeSwitchEntity;
    this.groupMembershipCaptured = false;
    this.wasInGroupBeforeYoutube = false;
    if (!shouldRestore) return;
    try {
      log('info', `[${this.definition.name}] Restoring individual player to M1S group after YT/YTM Stop.`, switchEntity);
      await switchTurnOn(switchEntity);
    } catch (error) {
      log('warn', `[${this.definition.name}] Could not restore player to M1S group after Stop.`, error?.message || String(error));
    }
  }

  async ensureInitialGroupCleanStart() {
    if (!this.definition.isGroup) return true;
    const expectedPath = this.expectedStreamPath();
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await haService(this.definition.entityId, 'media_stop');
        const stopped = await this.waitUntilTargetStopped(expectedPath);
        if (!stopped) throw new Error('group did not reach stopped state before YT/YTM session start');
        await sleep(500);
        log('debug', `[${this.definition.name}] One-time clean group STOP confirmed before continuous YT/YTM session.`);
        return true;
      } catch (error) {
        lastError = error;
        log(attempt < 3 ? 'warn' : 'error', `[${this.definition.name}] Initial group STOP attempt ${attempt}/3 failed.`, error?.message || String(error));
        if (attempt < 3) await sleep(180 * attempt);
      }
    }
    log('error', `[${this.definition.name}] Refusing YT/YTM session without a clean initial group boundary.`, lastError?.message || 'unknown error');
    return false;
  }

  async prepareVideo(video, position) {
    const id = safeVideoId(video?.id);
    if (!id) throw new Error(`Invalid YouTube video id: ${video?.id}`);
    const generation = ++this.playGeneration;
    this.currentVideo = video;
    this.currentVideoId = id;
    this.title = String(video?.title || `YouTube ${id}`);
    this.duration = Number(video?.duration || 0) || 0;
    this.basePosition = Math.max(0, Number(position) || 0);
    this.startedAt = null;
    this.paused = false;

    if (!video?.title || this.title === `YouTube ${id}`) {
      try {
        const quickTitle = await getQuickYouTubeTitle(id);
        if (generation !== this.playGeneration || id !== this.currentVideoId) return null;
        this.title = quickTitle || this.title;
      } catch (error) {
        log('debug', `[${this.definition.name}] Quick title lookup failed for ${id}; using fallback title.`, error?.message || String(error));
      }
    }
    setTimeout(() => void this.enrichMetadata(id, generation), 750);
    return { id, generation, position: this.basePosition };
  }

  async enrichMetadata(videoId, generation) {
    try {
      const metadata = await getMetadata(videoId);
      if (generation !== this.playGeneration || videoId !== this.currentVideoId) return;
      this.title = metadata?.title || this.title;
      this.duration = Number(metadata?.duration || 0) || this.duration;
      log('debug', `[${this.definition.name}] Metadata ready: ${this.title}`, this.duration ? `${this.duration.toFixed(1)}s` : '');
    } catch (error) {
      log('debug', `[${this.definition.name}] Metadata lookup failed for ${videoId}.`, error.message);
    }
  }

  async startContinuousSession(prepared) {
    this.captureSessionSenderForStart();
    await this.waitForPendingGroupSenderRestore();
    await this.ensureIndividualReadyForPlayback();
    if (!(await this.ensureInitialGroupCleanStart())) return false;

    const serial = nextStreamSerial();
    const session = new ContinuousAudioSession(this, serial);
    this.continuousSession = session;
    const trackGeneration = await session.queueTrack(prepared.id, prepared.position, { append: false });

    log('info', `[${this.definition.name}] Starting ONE continuous YT/YTM transport.`, `session=${serial}`);
    try {
      await haService(this.definition.entityId, 'play_media', {
        media_content_id: session.url,
        media_content_type: 'music',
        extra: {
          title: this.title,
          m1s_youtube_cast_receiver: true,
          m1s_youtube_continuous_session: true,
          video_id: prepared.id,
          stream_serial: serial
        }
      });
      this.ownsTarget = true;
      this.sessionRelinquished = false;
      this.startOwnershipMonitor();

      const firstPcmAt = await session.waitTrackOutputStart(trackGeneration);
      const transport = await this.waitForTransportStarted(serial);
      let transportAt = transport.at;
      if (transport.exact) {
        session.setTransportLeadMs(Math.max(0, transportAt - firstPcmAt));
      } else {
        session.setTransportLeadMs(transport.fallbackLeadMs || 2500);
        transportAt = firstPcmAt + session.transportLeadMs;
        const waitMs = transportAt - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        log('warn', `[${this.definition.name}] Transport-start serial unavailable; using one-time startup lead fallback.`);
      }
      if (prepared.generation !== this.playGeneration || this.sessionRelinquished) return false;
      this.startedAt = transportAt;
      this.basePosition = prepared.position;
      log('info', `[${this.definition.name}] Continuous YT/YTM session is audible; no more HA Play/Stop at song boundaries.`);
      return true;
    } catch (error) {
      log('error', `[${this.definition.name}] Continuous HA session start failed.`, error?.message || String(error));
      await session.stop();
      if (this.continuousSession === session) this.continuousSession = null;
      this.ownsTarget = false;
      return false;
    }
  }

  async switchTrackInsideSession(prepared, { append = false } = {}) {
    const session = this.continuousSession;
    if (!session?.active) return this.startContinuousSession(prepared);
    if (!(await this.targetStillOwnedByYoutube())) {
      await this.relinquishToExternalSource('track switch ignored because HA is playing another source');
      return false;
    }

    const trackGeneration = await session.queueTrack(prepared.id, prepared.position, { append });
    log('info', `[${this.definition.name}] YT/YTM track switched INSIDE continuous transport: ${this.title}`,
      append ? '(natural next)' : '(manual/seek replacement)');

    const outputAt = await session.waitTrackOutputStart(trackGeneration);
    const leadMs = Math.max(0, Number(session.transportLeadMs) || 0);
    const audibleAt = outputAt + leadMs;
    const waitMs = audibleAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    if (prepared.generation !== this.playGeneration || this.sessionRelinquished) return false;
    this.startedAt = audibleAt;
    this.basePosition = prepared.position;
    return true;
  }

  async play(video, position, AID) {
    // yt-cast-receiver may call stop() while replacing the selected video. Once
    // a continuous YT/YTM session exists, that logical stop MUST NOT become an
    // HA transport stop. The new video is spliced into the same PCM stream.
    const continuing = Boolean(this.continuousSession?.active && this.ownsTarget && !this.sessionRelinquished);
    if (continuing) this.preserveTransportAcrossStop = true;
    try {
      return await super.play(video, position, AID);
    } finally {
      this.preserveTransportAcrossStop = false;
    }
  }

  async doPlay(video, position) {
    this.sessionRelinquished = false;
    let prepared;
    try {
      prepared = await this.prepareVideo(video, position);
    } catch (error) {
      log('error', `[${this.definition.name}] ${error.message}`);
      return false;
    }
    if (!prepared) return false;

    // A same-phone Individual -> Group handoff can happen while the Group
    // transport is already alive (for example, another phone is controlling
    // the Group). Always finish the targeted restore before applying the new
    // Group command.
    await this.waitForPendingGroupSenderRestore();

    if (this.continuousSession?.active && this.ownsTarget) {
      return this.switchTrackInsideSession(prepared, { append: this.naturalAdvanceInProgress });
    }
    return this.startContinuousSession(prepared);
  }

  async handleContinuousSourceEof(videoId, sourceGeneration) {
    const session = this.continuousSession;
    if (!session?.active || this.paused || this.sessionRelinquished) return;
    if (videoId !== this.currentVideoId) return;
    if (sourceGeneration !== session.currentTrackGeneration) return;
    if (this.naturalAdvanceInProgress) return;

    this.naturalAdvanceInProgress = true;
    try {
      // Advance immediately at SOURCE EOF so extraction of the next song can run
      // while the final ~2.5 s of the old track are still queued. doPlay() stays
      // LOADING until the new track actually reaches the established transport.
      const advanced = await this.next();
      if (advanced) return;

      log('info', `[${this.definition.name}] Queue/autoplay has no next item; draining final track then stopping.`);
      const drainedAt = await session.waitTrackOutputDrain(sourceGeneration).catch(() => Date.now());
      const stopAt = drainedAt + Math.max(0, Number(session.transportLeadMs) || 0) + 150;
      const waitMs = stopAt - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      if (this.continuousSession === session && session.active) await this.stop();
    } catch (error) {
      log('error', `[${this.definition.name}] Continuous queue advance failed.`, error?.message || String(error));
    } finally {
      this.naturalAdvanceInProgress = false;
    }
  }

  async next(AID) {
    if (this.sessionRelinquished || (this.currentVideo && !(await this.targetStillOwnedByYoutube()))) {
      await this.relinquishToExternalSource('Next ignored after external source takeover');
      return false;
    }
    return super.next(AID);
  }

  async previous(AID) {
    if (this.sessionRelinquished || (this.currentVideo && !(await this.targetStillOwnedByYoutube()))) {
      await this.relinquishToExternalSource('Previous ignored after external source takeover');
      return false;
    }
    return super.previous(AID);
  }

  async doPause() {
    if (!this.continuousSession?.active) return false;
    if (!(await this.targetStillOwnedByYoutube())) {
      await this.relinquishToExternalSource('Pause ignored because HA is playing another source');
      return false;
    }
    this.basePosition = this.currentPosition();
    this.startedAt = null;
    this.paused = true;
    this.continuousSession.pause();
    this.ownsTarget = true;
    log('info', `[${this.definition.name}] Paused at ~${this.basePosition.toFixed(1)}s; HA transport remains open.`);
    return true;
  }

  async doResume() {
    if (!this.currentVideo || !this.continuousSession?.active) return false;
    if (this.sessionRelinquished || !(await this.targetStillOwnedByYoutube())) {
      await this.relinquishToExternalSource('Resume ignored because HA is playing another source');
      return false;
    }
    this.paused = false;
    const generation = ++this.playGeneration;
    const trackGeneration = await this.continuousSession.queueTrack(this.currentVideoId, this.basePosition, { append: false });
    const outputAt = await this.continuousSession.waitTrackOutputStart(trackGeneration);
    const audibleAt = outputAt + Math.max(0, Number(this.continuousSession.transportLeadMs) || 0);
    const waitMs = audibleAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    if (generation !== this.playGeneration) return false;
    this.startedAt = audibleAt;
    log('info', `[${this.definition.name}] Resumed inside existing continuous transport.`);
    return true;
  }

  async doStop() {
    if (this.preserveTransportAcrossStop && this.continuousSession?.active) {
      log('debug', `[${this.definition.name}] Logical YT/YTM track replacement: HA transport intentionally kept open.`);
      return true;
    }

    const session = this.continuousSession;
    const expectedPath = this.expectedStreamPath();
    const stillOwned = await this.targetStillOwnedByYoutube();
    const externalTakeover = this.sessionRelinquished || !stillOwned;

    this.stopOwnershipMonitor();
    this.playGeneration += 1;
    this.basePosition = 0;
    this.startedAt = null;
    this.paused = false;
    this.naturalAdvanceInProgress = false;
    this.continuousSession = null;

    if (session) await session.stop();

    let stopped = true;
    if (!externalTakeover) {
      try {
        await haService(this.definition.entityId, 'media_stop');
        await this.waitUntilTargetStopped(expectedPath);
        log('info', `[${this.definition.name}] Continuous YT/YTM session stopped.`);
      } catch (error) {
        stopped = false;
        log('error', `[${this.definition.name}] Stop failed.`, error.message);
      }
    } else {
      log('info', `[${this.definition.name}] YT/YTM session closed locally; newer HA source left untouched.`);
    }

    this.ownsTarget = false;
    await this.restoreIndividualGroupAfterStop(!externalTakeover);
    this.sessionSenderId = null;
    return stopped;
  }

  async doSeek(position) {
    if (!this.currentVideo || !this.continuousSession?.active) return false;
    if (this.sessionRelinquished || !(await this.targetStillOwnedByYoutube())) {
      await this.relinquishToExternalSource('Seek ignored because HA is playing another source');
      return false;
    }
    this.basePosition = Math.max(0, Number(position) || 0);
    this.startedAt = null;
    if (this.paused) return true;
    const generation = ++this.playGeneration;
    const trackGeneration = await this.continuousSession.queueTrack(this.currentVideoId, this.basePosition, { append: false });
    const outputAt = await this.continuousSession.waitTrackOutputStart(trackGeneration);
    const audibleAt = outputAt + Math.max(0, Number(this.continuousSession.transportLeadMs) || 0);
    const waitMs = audibleAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    if (generation !== this.playGeneration) return false;
    this.startedAt = audibleAt;
    log('info', `[${this.definition.name}] Seek completed inside continuous transport at ${this.basePosition.toFixed(1)}s.`);
    return true;
  }

  async doSetVolume(volume) {
    if (this.currentVideo && (this.sessionRelinquished || !(await this.targetStillOwnedByYoutube()))) {
      await this.relinquishToExternalSource('Volume command ignored because HA is playing another source');
      return false;
    }
    const level = Math.min(100, Math.max(0, Number(volume?.level) || 0));
    const muted = Boolean(volume?.muted);
    try {
      await haService(this.definition.entityId, 'volume_set', { volume_level: level / 100 });
      await haService(this.definition.entityId, 'volume_mute', { is_volume_muted: muted });
      this.volume = { level, muted };
      return true;
    } catch (error) {
      log('error', `[${this.definition.name}] Volume command failed.`, error.message);
      return false;
    }
  }

  async doGetVolume() {
    return this.volume;
  }

  async doGetPosition() {
    return this.currentPosition();
  }

  async doGetDuration() {
    return this.duration;
  }
}

async function initializeVolume(player) {
  try {
    const state = await haRequest(`/states/${encodeURIComponent(player.definition.entityId)}`);
    const attrs = state?.attributes || {};
    const level = Number(attrs.volume_level);
    const muted = Boolean(attrs.is_volume_muted);
    if (Number.isFinite(level)) {
      player.volume = { level: Math.round(level * 100), muted };
    }
  } catch (error) {
    log('warn', `[${player.definition.name}] Could not read initial target volume.`, error.message);
  }
}

function installQueueLogging(player) {
  const queue = player.queue;
  if (!queue?.on) return;

  queue.on('videoSelected', (event) => {
    log('info', `[${player.definition.name}] Queue selected: ${event?.videoId || 'unknown'}`);
  });
  queue.on('videoAdded', (event) => {
    log('debug', `[${player.definition.name}] Queue added: ${event?.videoId || 'unknown'}`);
  });
  queue.on('videoRemoved', (event) => {
    log('debug', `[${player.definition.name}] Queue removed: ${event?.videoId || 'unknown'}`);
  });
  queue.on('playlistSet', (event) => {
    log('info', `[${player.definition.name}] Playlist set: ${(event?.videoIds || []).length} item(s)`);
  });
  queue.on('playlistAdded', (event) => {
    log('info', `[${player.definition.name}] Playlist added: ${(event?.videoIds || []).length} item(s)`);
  });
  queue.on('playlistCleared', () => {
    log('info', `[${player.definition.name}] Playlist cleared.`);
  });
  queue.on('playlistUpdated', (event) => {
    log('debug', `[${player.definition.name}] Playlist updated: ${(event?.videoIds || []).length} item(s)`);
  });
  queue.on('autoplayModeChange', (previous, current) => {
    log('info', `[${player.definition.name}] Autoplay mode: ${previous} -> ${current}`);
  });
}

receiverDefinitions = await discoverReceiverDefinitions();
receiverDefinitionsByKey = new Map(receiverDefinitions.map((item) => [item.key, item]));

log('info', `Discovered ${receiverDefinitions.length} Cast receiver(s).`);
for (const def of receiverDefinitions) {
  const switchInfo = def.includeSwitchEntity ? ` group-switch:${def.includeSwitchEntity}` : '';
  log('info', `Receiver: "${def.name}"`, `${def.entityId} DIAL:${def.port}${switchInfo}`);
}

await new Promise((resolve, reject) => {
  audioServer.once('error', reject);
  audioServer.listen(cfg.audioPort, '0.0.0.0', () => resolve());
});
log('info', `Audio bridge listening on http://${streamHost}:${cfg.audioPort}`);

const runtimeReceivers = [];

try {
  for (const def of receiverDefinitions) {
    const player = new M1SPlayer(def);
    await initializeVolume(player);
    installQueueLogging(player);
    runtimePlayersByKey.set(def.key, player);

    const receiver = new YouTubeCastReceiver(player, {
      app: {
        enableAutoplayOnConnect: true,
        resetPlayerOnDisconnectPolicy: Constants.RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_EXPLICITLY_DISCONNECTED
      },
      dial: { port: def.port },
      device: {
        name: def.name,
        screenName: `YouTube on ${def.name}`,
        brand: 'Aqara / Home Assistant',
        model: 'SmartTV'
      },
      dataStore: new JsonDataStore(def.key),
      logLevel: cfg.logLevel
    });

    receiver.on('senderConnect', (sender) => {
      player.noteSenderConnected(sender);
      if (def.isGroup) player.queueSameSenderIndividualRestoreForGroup(sender);
      log('info', `[${def.name}] Sender connected: ${sender?.name || 'unknown'}`, `id=${sender?.id || 'unknown'}`);
    });
    receiver.on('senderDisconnect', (sender, implicit) => {
      player.noteSenderDisconnected(sender);
      log('info', `[${def.name}] Sender disconnected: ${sender?.name || 'unknown'} implicit=${Boolean(implicit)}`, `id=${sender?.id || 'unknown'}`);
    });
    receiver.on('error', (error) => log('error', `[${def.name}] Receiver error.`, error?.message || String(error)));
    receiver.on('terminate', (error) => log('error', `[${def.name}] Receiver terminated.`, error?.message || String(error)));

    const pairing = receiver.getPairingCodeRequestService();
    if (cfg.enableTvCode && def.isGroup) {
      pairing.on('response', (code) => {
        log('info', `[${def.name}] TV pairing code: ${code}`);
        log('info', 'Fallback: YouTube -> Settings -> Watch on TV -> Link with TV code.');
      });
      pairing.on('error', (error) => log('warn', `[${def.name}] TV-code service error.`, error?.message || String(error)));
    }

    await receiver.start();
    runtimeReceivers.push({ def, receiver, pairing });
    log('info', `DIAL receiver started: "${def.name}" on port ${def.port}`);

    if (cfg.enableTvCode && def.isGroup) pairing.start();
  }

  log('info', 'Open YouTube/YouTube Music on Android and press Cast.');
} catch (error) {
  log('error', 'Failed to start receiver set.', error?.stack || error?.message || String(error));
  for (const item of runtimeReceivers.reverse()) {
    try { item.pairing.stop(); } catch (_) {}
    try { await item.receiver.stop(); } catch (_) {}
  }
  process.exit(1);
}

async function shutdown(signal) {
  log('info', `Stopping (${signal})...`);
  killAllAudio();
  for (const item of runtimeReceivers.reverse()) {
    try { item.pairing.stop(); } catch (_) {}
    try { await item.receiver.stop(); } catch (_) {}
  }
  await new Promise((resolve) => audioServer.close(() => resolve()));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
