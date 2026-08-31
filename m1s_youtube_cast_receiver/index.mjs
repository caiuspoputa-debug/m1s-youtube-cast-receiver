import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import YouTubeCastReceiver, { Player } from 'yt-cast-receiver';

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

async function haRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`http://supervisor/core/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${supervisorToken}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Home Assistant API ${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
}

async function haService(service, data = {}) {
  return haRequest(`/services/media_player/${service}`, {
    method: 'POST',
    body: { entity_id: cfg.targetEntity, ...data }
  });
}

function safeVideoId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : null;
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
      } catch (e) {
        reject(new Error(`yt-dlp returned invalid metadata JSON: ${e.message}`));
      }
    });
  });
}

let streamSerial = 0;
let activeAudioChild = null;

function audioUrl(videoId, position = 0) {
  streamSerial += 1;
  return `http://${streamHost}:${cfg.audioPort}/audio/${encodeURIComponent(videoId)}/${streamSerial}?start=${Math.max(0, Number(position) || 0)}`;
}

function killActiveAudio() {
  if (activeAudioChild && !activeAudioChild.killed) {
    activeAudioChild.kill('SIGTERM');
  }
  activeAudioChild = null;
}

const audioServer = http.createServer((req, res) => {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, target: cfg.targetEntity, name: cfg.deviceName }));
    return;
  }
  if (parsed.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`M1S YouTube Cast Receiver\nTarget: ${cfg.targetEntity}\n`);
    return;
  }

  const match = parsed.pathname.match(/^\/audio\/([A-Za-z0-9_-]{6,32})\/\d+$/);
  if (!match) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const videoId = safeVideoId(match[1]);
  if (!videoId) {
    res.writeHead(400);
    res.end('Invalid video id');
    return;
  }

  const start = Math.max(0, Number(parsed.searchParams.get('start') || 0) || 0);
  log('info', `Audio requested: ${videoId}`, start > 0.5 ? `from ${start.toFixed(1)}s` : '');
  killActiveAudio();

  const args = [
    '--no-playlist', '--quiet', '--no-warnings', '--js-runtimes', 'node',
    '-f', 'bestaudio[ext=webm]/bestaudio',
    '-o', '-'
  ];
  if (start > 0.5) {
    args.push('--download-sections', `*${start}-`);
  }
  args.push(`https://www.youtube.com/watch?v=${videoId}`);

  const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeAudioChild = child;
  let stderr = '';

  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Connection': 'close'
  });

  child.stdout.pipe(res);
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 64 * 1024) stderr += chunk.toString();
  });
  child.on('error', (error) => {
    log('error', `yt-dlp stream process error: ${error.message}`);
    if (!res.destroyed) res.destroy(error);
  });
  child.on('close', (code) => {
    if (activeAudioChild === child) activeAudioChild = null;
    if (code !== 0 && code !== null) {
      log('error', `yt-dlp audio exited with code ${code}`, stderr.trim().slice(-1200));
    } else {
      log('debug', `yt-dlp audio finished for ${videoId}`);
    }
    if (!res.writableEnded) res.end();
  });
  res.on('close', () => {
    if (!res.writableEnded && !child.killed) child.kill('SIGTERM');
  });
});

class M1SPlayer extends Player {
  constructor() {
    super();
    this.currentVideo = null;
    this.title = null;
    this.duration = 0;
    this.basePosition = 0;
    this.startedAt = null;
    this.paused = false;
    this.volume = { level: 50, muted: false };
  }

  currentPosition() {
    if (this.startedAt === null || this.paused) return this.basePosition;
    return Math.max(0, this.basePosition + (Date.now() - this.startedAt) / 1000);
  }

  async startAt(video, position) {
    const id = safeVideoId(video?.id);
    if (!id) {
      log('error', `Invalid YouTube video id: ${video?.id}`);
      return false;
    }

    let metadata = null;
    try {
      metadata = await runYtDlpJson(id);
    } catch (error) {
      log('warn', `Metadata lookup failed for ${id}; trying playback anyway.`, error.message);
    }

    this.currentVideo = video;
    this.title = metadata?.title || `YouTube ${id}`;
    this.duration = Number(metadata?.duration || 0) || 0;
    this.basePosition = Math.max(0, Number(position) || 0);
    this.startedAt = Date.now();
    this.paused = false;

    const url = audioUrl(id, this.basePosition);
    log('info', `Play: ${this.title}`, `-> ${cfg.targetEntity}`);
    try {
      await haService('play_media', {
        media_content_id: url,
        media_content_type: 'music',
        extra: { title: this.title }
      });
      return true;
    } catch (error) {
      log('error', 'Home Assistant play_media failed.', error.message);
      this.startedAt = null;
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
    killActiveAudio();
    try {
      await haService('media_stop');
      log('info', `Paused at ~${this.basePosition.toFixed(1)}s`);
      return true;
    } catch (error) {
      log('error', 'Pause/stop failed.', error.message);
      return false;
    }
  }

  async doResume() {
    if (!this.currentVideo) return false;
    return this.startAt(this.currentVideo, this.basePosition);
  }

  async doStop() {
    this.basePosition = 0;
    this.startedAt = null;
    this.paused = false;
    killActiveAudio();
    try {
      await haService('media_stop');
      log('info', 'Stopped.');
      return true;
    } catch (error) {
      log('error', 'Stop failed.', error.message);
      return false;
    }
  }

  async doSeek(position) {
    if (!this.currentVideo) return false;
    this.basePosition = Math.max(0, Number(position) || 0);
    if (this.paused) return true;
    killActiveAudio();
    try {
      await haService('media_stop');
    } catch (_) {
      // Latest play request below is authoritative.
    }
    return this.startAt(this.currentVideo, this.basePosition);
  }

  async doSetVolume(volume) {
    const level = Math.min(100, Math.max(0, Number(volume?.level) || 0));
    const muted = Boolean(volume?.muted);
    try {
      await haService('volume_set', { volume_level: level / 100 });
      await haService('volume_mute', { is_volume_muted: muted });
      this.volume = { level, muted };
      log('debug', `Volume ${level}% mute=${muted}`);
      return true;
    } catch (error) {
      log('error', 'Volume command failed.', error.message);
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
    const state = await haRequest(`/states/${encodeURIComponent(cfg.targetEntity)}`);
    const attrs = state?.attributes || {};
    const level = Number(attrs.volume_level);
    const muted = Boolean(attrs.is_volume_muted);
    if (Number.isFinite(level)) {
      player.volume = { level: Math.round(level * 100), muted };
    }
  } catch (error) {
    log('warn', 'Could not read initial target volume.', error.message);
  }
}

const player = new M1SPlayer();
await initializeVolume(player);

const receiver = new YouTubeCastReceiver(player, {
  dial: { port: cfg.dialPort },
  device: {
    name: cfg.deviceName,
    screenName: `YouTube on ${cfg.deviceName}`,
    brand: 'Aqara / Home Assistant',
    model: 'SmartTV'
  },
  logLevel: cfg.logLevel
});

receiver.on('senderConnect', (sender) => {
  log('info', `Sender connected: ${sender?.name || 'unknown'}`);
});
receiver.on('senderDisconnect', (sender, implicit) => {
  log('info', `Sender disconnected: ${sender?.name || 'unknown'} implicit=${Boolean(implicit)}`);
});
receiver.on('error', (error) => log('error', 'Receiver error.', error?.message || String(error)));
receiver.on('terminate', (error) => log('error', 'Receiver terminated.', error?.message || String(error)));

const pairing = receiver.getPairingCodeRequestService();
if (cfg.enableTvCode) {
  pairing.on('response', (code) => {
    log('info', `TV pairing code: ${code}`);
    log('info', 'Fallback: YouTube -> Settings -> Watch on TV -> Link with TV code.');
  });
  pairing.on('error', (error) => log('warn', 'TV-code service error.', error?.message || String(error)));
}

await new Promise((resolve, reject) => {
  audioServer.once('error', reject);
  audioServer.listen(cfg.audioPort, '0.0.0.0', () => resolve());
});
log('info', `Audio bridge listening on http://${streamHost}:${cfg.audioPort}`);

try {
  await receiver.start();
  log('info', `DIAL receiver started: "${cfg.deviceName}" on port ${cfg.dialPort}`);
  log('info', 'Open YouTube/YouTube Music on Android and press Cast.');
  if (cfg.enableTvCode) pairing.start();
} catch (error) {
  log('error', 'Failed to start receiver.', error?.stack || error?.message || String(error));
  process.exit(1);
}

async function shutdown(signal) {
  log('info', `Stopping (${signal})...`);
  killActiveAudio();
  try { pairing.stop(); } catch (_) {}
  try { await receiver.stop(); } catch (_) {}
  await new Promise((resolve) => audioServer.close(() => resolve()));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
