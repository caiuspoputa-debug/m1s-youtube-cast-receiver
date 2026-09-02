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
    resumeInterruptedStream: raw.resume_interrupted_stream !== false,
    resumeInterruptedDelayMs: Math.max(0, Number(raw.resume_interrupted_delay_ms ?? 300)),
    autoRemoveIndividualFromGroup: raw.auto_remove_individual_from_group !== false,
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
const activeAudioChildren = new Map();
const runtimePlayersByKey = new Map();
let receiverDefinitions = [];
let receiverDefinitionsByKey = new Map();

function audioUrl(receiverKey, videoId, position = 0) {
  streamSerial += 1;
  const serial = streamSerial;
  return {
    serial,
    url: `http://${streamHost}:${cfg.audioPort}/audio/${encodeURIComponent(receiverKey)}/${encodeURIComponent(videoId)}/${serial}?start=${Math.max(0, Number(position) || 0)}`
  };
}

function killActiveAudio(receiverKey) {
  const child = activeAudioChildren.get(receiverKey);
  if (child && !child.killed) child.kill('SIGTERM');
  activeAudioChildren.delete(receiverKey);
}

function killAllAudio() {
  for (const key of activeAudioChildren.keys()) killActiveAudio(key);
}

const audioServer = http.createServer((req, res) => {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      receivers: receiverDefinitions.map((item) => ({ name: item.name, entity_id: item.entityId, port: item.port }))
    }));
    return;
  }
  if (parsed.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`M1S YouTube Cast Receiver\nReceivers: ${receiverDefinitions.length}\n`);
    return;
  }

  const match = parsed.pathname.match(/^\/audio\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{6,32})\/(\d+)$/);
  if (!match) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const receiverKey = safeKey(match[1]);
  const videoId = safeVideoId(match[2]);
  const serial = Number(match[3]);
  const def = receiverDefinitionsByKey.get(receiverKey);
  if (!def || !videoId || !Number.isSafeInteger(serial)) {
    res.writeHead(400);
    res.end('Invalid receiver or video id');
    return;
  }

  const start = Math.max(0, Number(parsed.searchParams.get('start') || 0) || 0);
  log('info', `[${def.name}] Audio requested: ${videoId}`, start > 0.5 ? `from ${start.toFixed(1)}s` : '');
  killActiveAudio(receiverKey);

  const args = [
    '--no-playlist', '--quiet', '--no-warnings', '--js-runtimes', 'node',
    '-f', 'bestaudio[ext=webm]/bestaudio',
    '-o', '-'
  ];
  if (start > 0.5) args.push('--download-sections', `*${start}-`);
  args.push(`https://www.youtube.com/watch?v=${videoId}`);

  const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeAudioChildren.set(receiverKey, child);
  const player = runtimePlayersByKey.get(receiverKey);
  let stderr = '';
  let childClosed = false;

  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Connection': 'close',
    'X-M1S-YT-Stream-Serial': String(serial)
  });

  child.stdout.pipe(res);
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 64 * 1024) stderr += chunk.toString();
  });
  child.on('error', (error) => {
    log('error', `[${def.name}] yt-dlp stream process error: ${error.message}`);
    if (!res.destroyed) res.destroy(error);
  });
  child.on('close', (code) => {
    childClosed = true;
    if (activeAudioChildren.get(receiverKey) === child) activeAudioChildren.delete(receiverKey);
    if (code !== 0 && code !== null) {
      log('error', `[${def.name}] yt-dlp audio exited with code ${code}`, stderr.trim().slice(-1200));
    } else {
      log('debug', `[${def.name}] yt-dlp audio finished for ${videoId}`);
    }
    if (!res.writableEnded) res.end();
  });
  res.on('close', () => {
    if (!res.writableEnded && !childClosed) {
      player?.handleStreamInterrupted(serial, videoId, 'audio client closed the stream');
      if (!child.killed) child.kill('SIGTERM');
    }
  });
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
    this.endTimer = null;
    this.interruptResumeTimer = null;
    this.endTransitionRunning = false;
    this.currentStream = null;
  }

  currentPosition() {
    if (this.startedAt === null || this.paused) return this.basePosition;
    return Math.max(0, this.basePosition + (Date.now() - this.startedAt) / 1000);
  }

  clearEndTimer() {
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  clearInterruptResumeTimer() {
    if (this.interruptResumeTimer) {
      clearTimeout(this.interruptResumeTimer);
      this.interruptResumeTimer = null;
    }
  }

  scheduleEndTransition(generation) {
    this.clearEndTimer();
    if (this.paused || this.startedAt === null || generation !== this.playGeneration) return;

    const remaining = Number(this.duration) - this.currentPosition();
    if (!Number.isFinite(remaining) || remaining <= 1) {
      log('debug', `[${this.definition.name}] End transition not scheduled; duration is not ready.`);
      return;
    }

    const delayMs = Math.min(Math.max(remaining + 1.5, 2), 24 * 60 * 60) * 1000;
    this.endTimer = setTimeout(() => void this.handlePlaybackEnded(generation), delayMs);
    log('debug', `[${this.definition.name}] Next-item transition scheduled in ~${(delayMs / 1000).toFixed(1)}s`);
  }

  async handlePlaybackEnded(generation) {
    if (generation !== this.playGeneration || this.paused || this.startedAt === null) return;
    if (this.endTransitionRunning) return;

    this.endTransitionRunning = true;
    this.clearEndTimer();
    this.clearInterruptResumeTimer();
    const endedVideoId = this.currentVideoId;
    log('info', `[${this.definition.name}] Playback finished: ${endedVideoId}; requesting next queue item.`);

    try {
      await this.pause();
      const advanced = await this.next();
      if (!advanced) {
        log('info', `[${this.definition.name}] Queue/autoplay had no next item; stopping.`);
        await this.stop();
      } else if (this.currentVideoId === endedVideoId) {
        log('warn', `[${this.definition.name}] Queue selected the same video again; leaving sender state unchanged.`);
      }
    } catch (error) {
      log('error', `[${this.definition.name}] Next-item transition failed.`, error?.message || String(error));
    } finally {
      this.endTransitionRunning = false;
    }
  }

  async ensureIndividualReadyForPlayback() {
    if (!cfg.autoRemoveIndividualFromGroup || this.definition.isGroup || !this.definition.includeSwitchEntity) return;

    // Keep the receiver -> hub mapping exactly as discovered at startup.
    // turn_off is idempotent, so do not depend on a possibly stale HA state.
    const switchEntity = this.definition.includeSwitchEntity;
    try {
      log('info', `[${this.definition.name}] Removing individual player from M1S group before playback.`, switchEntity);
      await switchTurnOff(switchEntity);
      await sleep(cfg.autoRemoveGroupDelayMs);
    } catch (error) {
      log('warn', `[${this.definition.name}] Could not remove player from M1S group before playback.`, error?.message || String(error));
    }
  }

  handleStreamInterrupted(serial, videoId, reason) {
    // v0.3.13 stability mode: never try to guess why the HTTP audio client closed.
    // In particular, do not auto-resume/restart YouTube after notifications,
    // source switches, Home Assistant teardown, or transient client disconnects.
    // Queue/autoplay advancement remains driven only by the normal track timer.
    if (!this.currentStream || this.currentStream.serial !== serial || this.currentStream.videoId !== videoId) return;
    log('debug', `[${this.definition.name}] Audio client closed; interruption auto-resume intentionally disabled.`, reason);
    this.currentStream = null;
  }

  async enrichMetadata(videoId, generation) {
    try {
      const metadata = await getMetadata(videoId);
      if (generation !== this.playGeneration || videoId !== this.currentVideoId) return;
      this.title = metadata?.title || this.title;
      this.duration = Number(metadata?.duration || 0) || this.duration;
      log('debug', `[${this.definition.name}] Metadata ready: ${this.title}`, this.duration ? `${this.duration.toFixed(1)}s` : '');
      this.scheduleEndTransition(generation);
    } catch (error) {
      log('debug', `[${this.definition.name}] Metadata lookup failed for ${videoId}.`, error.message);
    }
  }

  async startAt(video, position) {
    const id = safeVideoId(video?.id);
    if (!id) {
      log('error', `[${this.definition.name}] Invalid YouTube video id: ${video?.id}`);
      return false;
    }

    this.playGeneration += 1;
    const generation = this.playGeneration;
    this.currentVideo = video;
    this.currentVideoId = id;
    this.title = String(video?.title || `YouTube ${id}`);
    this.duration = Number(video?.duration || 0) || 0;
    this.basePosition = Math.max(0, Number(position) || 0);
    this.startedAt = Date.now();
    this.paused = false;
    this.clearEndTimer();
    this.clearInterruptResumeTimer();

    await this.ensureIndividualReadyForPlayback();

    const stream = audioUrl(this.definition.key, id, this.basePosition);
    this.currentStream = { serial: stream.serial, videoId: id };
    log('info', `[${this.definition.name}] Play: ${this.title}`, `-> ${this.definition.entityId}`);

    try {
      // Fast start: do not block playback on a separate yt-dlp metadata lookup.
      await haService(this.definition.entityId, 'play_media', {
        media_content_id: stream.url,
        media_content_type: 'music',
        extra: {
          title: this.title,
          m1s_youtube_cast_receiver: true,
          video_id: id,
          stream_serial: stream.serial
        }
      });

      // Metadata is deliberately delayed and fetched in the background so it does
      // not compete with the first audio extraction during startup.
      setTimeout(() => void this.enrichMetadata(id, generation), 750);
      this.scheduleEndTransition(generation);
      return true;
    } catch (error) {
      log('error', `[${this.definition.name}] Home Assistant play_media failed.`, error.message);
      this.startedAt = null;
      this.currentStream = null;
      this.clearEndTimer();
      this.clearInterruptResumeTimer();
      return false;
    }
  }

  async doPlay(video, position) {
    return this.startAt(video, position);
  }

  async doPause() {
    this.basePosition = this.currentPosition();
    this.startedAt = null;
    this.paused = true;
    this.clearEndTimer();
    this.clearInterruptResumeTimer();
    killActiveAudio(this.definition.key);
    try {
      await haService(this.definition.entityId, 'media_stop');
      log('info', `[${this.definition.name}] Paused at ~${this.basePosition.toFixed(1)}s`);
      return true;
    } catch (error) {
      log('error', `[${this.definition.name}] Pause/stop failed.`, error.message);
      return false;
    }
  }

  async doResume() {
    if (!this.currentVideo) return false;
    return this.startAt(this.currentVideo, this.basePosition);
  }

  async doStop() {
    this.playGeneration += 1;
    this.basePosition = 0;
    this.startedAt = null;
    this.paused = false;
    this.currentStream = null;
    this.clearEndTimer();
    this.clearInterruptResumeTimer();
    killActiveAudio(this.definition.key);
    try {
      await haService(this.definition.entityId, 'media_stop');
      log('info', `[${this.definition.name}] Stopped.`);
      return true;
    } catch (error) {
      log('error', `[${this.definition.name}] Stop failed.`, error.message);
      return false;
    }
  }

  async doSeek(position) {
    if (!this.currentVideo) return false;
    this.basePosition = Math.max(0, Number(position) || 0);
    this.clearEndTimer();
    this.clearInterruptResumeTimer();
    if (this.paused) return true;
    killActiveAudio(this.definition.key);
    try {
      await haService(this.definition.entityId, 'media_stop');
    } catch (_) {
      // The new play request below is authoritative.
    }
    return this.startAt(this.currentVideo, this.basePosition);
  }

  async doSetVolume(volume) {
    const level = Math.min(100, Math.max(0, Number(volume?.level) || 0));
    const muted = Boolean(volume?.muted);
    try {
      await haService(this.definition.entityId, 'volume_set', { volume_level: level / 100 });
      await haService(this.definition.entityId, 'volume_mute', { is_volume_muted: muted });
      this.volume = { level, muted };
      log('debug', `[${this.definition.name}] Volume ${level}% mute=${muted}`);
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
      log('info', `[${def.name}] Sender connected: ${sender?.name || 'unknown'}`);
    });
    receiver.on('senderDisconnect', (sender, implicit) => {
      log('info', `[${def.name}] Sender disconnected: ${sender?.name || 'unknown'} implicit=${Boolean(implicit)}`);
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
