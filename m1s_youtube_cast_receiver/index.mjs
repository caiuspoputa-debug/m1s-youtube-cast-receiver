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

  // v0.3.19 test: time-compress YouTube audio by exactly 3% in the add-on.
  // Nothing downstream changes sample format/rate logic; FFmpeg only applies atempo=1.03
  // and remuxes the result as a streaming Ogg/Opus payload for Home Assistant.
  const ytdlp = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0',
    '-vn',
    '-filter:a', 'atempo=1.03',
    '-c:a', 'libopus', '-b:a', '160k',
    '-f', 'ogg', 'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  const pipeline = {
    killed: false,
    kill(signal = 'SIGTERM') {
      this.killed = true;
      if (!ytdlp.killed) ytdlp.kill(signal);
      if (!ffmpeg.killed) ffmpeg.kill(signal);
    }
  };
  activeAudioChildren.set(receiverKey, pipeline);

  const player = runtimePlayersByKey.get(receiverKey);
  let ytdlpStderr = '';
  let ffmpegStderr = '';
  let pipelineClosed = false;

  res.writeHead(200, {
    'Content-Type': 'audio/ogg',
    'Cache-Control': 'no-store',
    'Connection': 'close',
    'X-M1S-YT-Stream-Serial': String(serial),
    'X-M1S-YT-Speed': '1.01'
  });

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(res);

  ytdlp.stderr.on('data', (chunk) => {
    if (ytdlpStderr.length < 64 * 1024) ytdlpStderr += chunk.toString();
  });
  ffmpeg.stderr.on('data', (chunk) => {
    if (ffmpegStderr.length < 64 * 1024) ffmpegStderr += chunk.toString();
  });

  ytdlp.on('error', (error) => {
    log('error', `[${def.name}] yt-dlp stream process error: ${error.message}`);
    pipeline.kill('SIGTERM');
    if (!res.destroyed) res.destroy(error);
  });
  ffmpeg.on('error', (error) => {
    log('error', `[${def.name}] 1% speed FFmpeg process error: ${error.message}`);
    pipeline.kill('SIGTERM');
    if (!res.destroyed) res.destroy(error);
  });

  ytdlp.on('close', (code) => {
    if (code !== 0 && code !== null && !pipeline.killed) {
      log('error', `[${def.name}] yt-dlp audio exited with code ${code}`, ytdlpStderr.trim().slice(-1200));
    }
  });

  ffmpeg.on('close', (code) => {
    pipelineClosed = true;
    if (activeAudioChildren.get(receiverKey) === pipeline) activeAudioChildren.delete(receiverKey);
    if (code !== 0 && code !== null && !pipeline.killed) {
      log('error', `[${def.name}] 1% speed FFmpeg exited with code ${code}`, ffmpegStderr.trim().slice(-1200));
    } else if (!pipeline.killed) {
      log('debug', `[${def.name}] 1% speed audio finished for ${videoId}`);
    }
    if (!res.writableEnded) res.end();
  });

  res.on('close', () => {
    if (!res.writableEnded && !pipelineClosed) {
      player?.handleStreamInterrupted(serial, videoId, 'audio client closed the stream');
      pipeline.kill('SIGTERM');
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
    this.completionTask = null;
    this.endTransitionRunning = false;
    this.currentStream = null;
  }

  currentPosition() {
    if (this.startedAt === null || this.paused) return this.basePosition;
    return Math.max(0, this.basePosition + (Date.now() - this.startedAt) / 1000);
  }

  clearEndTimer() {
    // v0.3.16: duration-based end timers are intentionally disabled.
    // Track completion is detected from the Home Assistant finite-media state.
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

  cancelCompletionMonitor() {
    if (this.completionTask) {
      this.completionTask.cancelled = true;
      this.completionTask = null;
    }
  }

  expectedStreamPath() {
    if (!this.currentStream) return null;
    return `/audio/${encodeURIComponent(this.definition.key)}/${encodeURIComponent(this.currentStream.videoId)}/${this.currentStream.serial}`;
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
        maxAlsaDelaySeconds = Math.max(maxAlsaDelaySeconds, frames / 32000);
      }
    }
    return {
      state: String(state?.state || '').toLowerCase(),
      mediaId: String(attrs.media_content_id || attrs.media_content_url || attrs.last_media_id || ''),
      remotePrefillSeconds: Number(attrs.group_remote_prefill_seconds || 0) || 0,
      maxAlsaDelaySeconds
    };
  }

  async waitUntilTargetStopped(expectedPath, timeoutMs = 2200) {
    const deadline = Date.now() + Math.max(100, timeoutMs);
    while (Date.now() < deadline) {
      try {
        const snapshot = await this.readTargetPlaybackState();
        const active = snapshot.state === 'playing' || snapshot.state === 'buffering';
        if (!active) return true;
        // If a newer source has already taken ownership, do not stop it here.
        if (expectedPath && snapshot.mediaId && !snapshot.mediaId.includes(expectedPath)) return true;
      } catch (_) {
        // A successful service call is still authoritative; retry state briefly.
      }
      await sleep(60);
    }
    return false;
  }

  startCompletionMonitor(generation) {
    this.cancelCompletionMonitor();
    const token = { cancelled: false };
    this.completionTask = token;

    void (async () => {
      const expectedPath = this.expectedStreamPath();
      if (!expectedPath) return;
      let sawOurActiveSource = false;

      while (!token.cancelled && generation === this.playGeneration) {
        try {
          const snapshot = await this.readTargetPlaybackState();
          const isOurSource = Boolean(snapshot.mediaId && snapshot.mediaId.includes(expectedPath));
          const active = snapshot.state === 'playing' || snapshot.state === 'buffering';

          if (isOurSource && active) {
            sawOurActiveSource = true;
          } else if (sawOurActiveSource && isOurSource && !active) {
            // v0.10.36 marks finite-media EOF as IDLE when the final PCM has
            // been handed to the hub pipelines. Allow only the receiver-side
            // prefill tail to drain; this is derived from the integration state,
            // not a duration/timeline guess.
            const bufferedTailSeconds = Math.max(snapshot.remotePrefillSeconds, snapshot.maxAlsaDelaySeconds || 0);
            const drainMs = Math.max(250, Math.min(3000, Math.round((bufferedTailSeconds + 0.25) * 1000)));
            if (drainMs > 0) await sleep(drainMs);
            if (token.cancelled || generation !== this.playGeneration) return;

            const confirm = await this.readTargetPlaybackState();
            const confirmOurSource = Boolean(confirm.mediaId && confirm.mediaId.includes(expectedPath));
            const confirmActive = confirm.state === 'playing' || confirm.state === 'buffering';
            if (confirmOurSource && !confirmActive) {
              await this.handlePlaybackEnded(generation);
              return;
            }
          } else if (sawOurActiveSource && snapshot.mediaId && !isOurSource) {
            // A persistent newer HA source (Radio, etc.) owns the player now.
            // Do not let the YouTube local queue reclaim it.
            log('info', `[${this.definition.name}] HA source changed away from YouTube; cancelling automatic queue advance.`);
            this.cancelCompletionMonitor();
            return;
          }
        } catch (error) {
          log('debug', `[${this.definition.name}] Completion-state poll failed.`, error?.message || String(error));
        }
        await sleep(250);
      }
    })().finally(() => {
      if (this.completionTask === token) this.completionTask = null;
    });
  }

  scheduleEndTransition(generation) {
    // Kept as a compatibility no-op. v0.3.16 never advances by metadata duration.
    this.clearEndTimer();
    if (generation === this.playGeneration) this.startCompletionMonitor(generation);
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
      // Do not STOP twice at a natural track boundary. The next queue item
      // enters through startAt(), whose clean-start path performs the single
      // authoritative HA STOP -> stopped confirmation -> old stream teardown
      // -> PLAY sequence. Calling pause()/STOP here as well caused a second
      // transport reset and could desynchronize the group.
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

  async ensureGroupCleanStart() {
    if (!this.definition.isGroup) return true;

    // Mirror the manual sequence that is known to synchronize the hubs:
    // HA STOP first while the old HTTP stream still exists, wait for HA to
    // report the group stopped, then terminate the obsolete stream. No fixed
    // 300 ms delay on the normal path.
    const expectedPath = this.expectedStreamPath();
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await haService(this.definition.entityId, 'media_stop');
        const stopped = await this.waitUntilTargetStopped(expectedPath);
        if (!stopped) throw new Error('group did not reach a stopped state before Play');
        killActiveAudio(this.definition.key);
        log('debug', `[${this.definition.name}] Clean group STOP confirmed before Play.`);
        return true;
      } catch (error) {
        lastError = error;
        log(attempt < 3 ? 'warn' : 'error', `[${this.definition.name}] Pre-Play group STOP attempt ${attempt}/3 failed.`, error?.message || String(error));
        // Backoff exists only on an actual failed STOP/state confirmation.
        if (attempt < 3) await sleep(180 * attempt);
      }
    }
    log('error', `[${this.definition.name}] Refusing group Play without a clean STOP boundary.`, lastError?.message || 'unknown error');
    return false;
  }

  handleStreamInterrupted(serial, videoId, reason) {
    // Stability mode: never infer a notification or transport failure here.
    // The current queue item is not restarted and the queue is not advanced.
    if (!this.currentStream || this.currentStream.serial !== serial || this.currentStream.videoId !== videoId) return;
    log('debug', `[${this.definition.name}] Audio client closed; interruption recovery disabled.`, reason);
    this.currentStream = null;
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

    // Resolve a real title before the single HA play_media call when the sender
    // only supplies a video id. This is the lightweight title fix from v0.3.9.
    if (!video?.title || this.title === `YouTube ${id}`) {
      try {
        const quickTitle = await getQuickYouTubeTitle(id);
        if (generation !== this.playGeneration || id !== this.currentVideoId) return false;
        this.title = quickTitle || this.title;
        log('debug', `[${this.definition.name}] Quick title ready: ${this.title}`);
      } catch (error) {
        log('debug', `[${this.definition.name}] Quick title lookup failed for ${id}; using fallback title.`, error?.message || String(error));
      }
    }

    this.basePosition = Math.max(0, Number(position) || 0);
    this.startedAt = null;
    this.paused = false;
    this.clearEndTimer();
    this.clearInterruptResumeTimer();
    this.cancelCompletionMonitor();

    await this.ensureIndividualReadyForPlayback();
    if (!(await this.ensureGroupCleanStart())) {
      this.startedAt = null;
      this.currentStream = null;
      this.clearEndTimer();
      this.clearInterruptResumeTimer();
      return false;
    }

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

      // Start the logical track clock only after Home Assistant accepted Play.
      // This deliberately biases the boundary late rather than cutting audio early.
      if (generation === this.playGeneration) this.startedAt = Date.now();

      // Metadata is deliberately delayed and fetched in the background so it does
      // not compete with the first audio extraction during startup.
      setTimeout(() => void this.enrichMetadata(id, generation), 750);
      this.startCompletionMonitor(generation);
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
    this.cancelCompletionMonitor();
    const expectedPath = this.expectedStreamPath();
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await haService(this.definition.entityId, 'media_stop');
        await this.waitUntilTargetStopped(expectedPath);
        killActiveAudio(this.definition.key);
        log('info', `[${this.definition.name}] Paused at ~${this.basePosition.toFixed(1)}s`);
        return true;
      } catch (error) {
        lastError = error;
        log(attempt < 3 ? 'warn' : 'error', `[${this.definition.name}] Pause/stop attempt ${attempt}/3 failed.`, error.message);
        if (attempt < 3) await sleep(180 * attempt);
      }
    }
    log('error', `[${this.definition.name}] Pause/stop failed after retries.`, lastError?.message || 'unknown error');
    return false;
  }

  async doResume() {
    if (!this.currentVideo) return false;
    return this.startAt(this.currentVideo, this.basePosition);
  }

  async doStop() {
    const expectedPath = this.expectedStreamPath();
    this.playGeneration += 1;
    this.basePosition = 0;
    this.startedAt = null;
    this.paused = false;
    this.clearEndTimer();
    this.clearInterruptResumeTimer();
    this.cancelCompletionMonitor();
    try {
      await haService(this.definition.entityId, 'media_stop');
      await this.waitUntilTargetStopped(expectedPath);
      killActiveAudio(this.definition.key);
      this.currentStream = null;
      log('info', `[${this.definition.name}] Stopped.`);
      return true;
    } catch (error) {
      // Even on HA failure, do not leave the old yt-dlp child around forever.
      killActiveAudio(this.definition.key);
      this.currentStream = null;
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

    // A seek is a brand-new transport start. Do not pre-stop or kill the old
    // HTTP stream here: startAt() already performs the proven clean sequence
    // HA STOP -> stopped confirmation -> old stream teardown -> PLAY. Keeping
    // one authoritative boundary avoids the former double STOP/reset.
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
