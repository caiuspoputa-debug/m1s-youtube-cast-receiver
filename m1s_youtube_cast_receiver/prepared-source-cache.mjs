import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_INFO_BYTES = 8 * 1024 * 1024;
const URL_EXPIRY_MARGIN_MS = 30 * 1000;
const SECTION_FIELDS = ['section_start', 'section_end', 'section_title', 'section_number'];

function reusableInfo(info, videoId) {
  if (!info || Array.isArray(info) || typeof info !== 'object' || String(info.id) !== videoId) return null;
  if (info._type && info._type !== 'video') return null;
  try {
    const selectedUrl = new URL(info.url);
    if (!['http:', 'https:'].includes(selectedUrl.protocol)) return null;
  } catch (_) { return null; }
  const copy = {...info};
  // A new --download-sections range must start from the full track, not an old seek.
  for (const key of SECTION_FIELDS) delete copy[key];
  // yt-dlp otherwise retries extraction internally, hiding failures from our one fresh retry.
  delete copy.webpage_url;
  return copy;
}

function signedExpiry(info) {
  let expiresAt = Infinity;
  const selected = [info, ...(Array.isArray(info.requested_formats) ? info.requested_formats : [])];
  for (const format of selected) {
    try {
      const url = new URL(format.url);
      for (const key of ['expire', 'expires', 'Expires']) {
        const value = url.searchParams.get(key);
        if (value && /^\d{9,}$/.test(value)) {
          const milliseconds = Number(value) * 1000;
          if (Number.isFinite(milliseconds)) expiresAt = Math.min(expiresAt, milliseconds - URL_EXPIRY_MARGIN_MS);
        }
      }
    } catch (_) { /* Non-selected or malformed URLs cannot extend cache lifetime. */ }
  }
  return expiresAt;
}

export class PreparedSourceCache {
  constructor({maxEntries = 8, ttlMs = DEFAULT_TTL_MS, now = Date.now, tmpDir = os.tmpdir(), log = () => {}} = {}) {
    this.maxEntries = Math.max(1, Math.floor(Number(maxEntries) || 8));
    this.ttlMs = Math.max(1, Number(ttlMs) || DEFAULT_TTL_MS);
    this.now = now;
    this.tmpDir = tmpDir;
    this.log = log;
    this.entries = new Map();
    this.sequence = 0;
  }

  _prune() {
    const now = this.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  clear() {
    this.entries.clear();
  }

  displayMetadata(videoId) {
    this._prune();
    const entry = this.entries.get(String(videoId));
    if (!entry) return null;
    try {
      const info = JSON.parse(entry.serialized);
      return {
        title: typeof info.title === 'string' ? info.title : '',
        artist: typeof info.artist === 'string' ? info.artist : '',
        uploader: typeof info.uploader === 'string' ? info.uploader : '',
        channel: typeof info.channel === 'string' ? info.channel : '',
        duration: Number(info.duration) || 0
      };
    } catch (_) { return null; }
  }

  plan(videoId, _position = 0) {
    const id = String(videoId);
    const sourceArgs = [`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`];
    const sequence = ++this.sequence;
    this._prune();
    let entry = this.entries.get(id);
    let directory;
    let file;
    let cleaned = false;
    let captured = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { if (file) fs.unlinkSync(file); } catch (_) {}
      try { if (directory) fs.rmdirSync(directory); } catch (_) {}
    };
    const invalidate = () => {
      // A cancelled older attempt must not evict metadata obtained by a newer one.
      if (entry && this.entries.get(id) === entry) this.entries.delete(id);
    };
    try {
      directory = fs.mkdtempSync(path.join(this.tmpDir, 'm1s-prepared-source-'));
      file = path.join(directory, 'source-info.json');
      fs.writeFileSync(file, entry ? entry.serialized : '', {mode: 0o600});
    } catch (_) {
      cleanup();
      this.log('info', '[TIMING][PIPELINE] prepared_source_cache_unavailable=true; using fresh extraction');
      return {args: [], sourceArgs, reused: false, capture: () => false, invalidate: () => {}, cleanup};
    }
    if (entry) {
      this.entries.delete(id);
      this.entries.set(id, entry);
      return {args: ['--load-info-json', file], sourceArgs: [], reused: true,
        capture: () => false, invalidate, cleanup};
    }
    const capture = () => {
      if (cleaned || captured) return captured;
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INFO_BYTES) return false;
        const info = reusableInfo(JSON.parse(fs.readFileSync(file, 'utf8')), id);
        if (!info) return false;
        const expiresAt = Math.min(this.now() + this.ttlMs, signedExpiry(info));
        if (expiresAt <= this.now()) return false;
        const current = this.entries.get(id);
        if (current && current.sequence > sequence) return false;
        entry = {serialized: JSON.stringify(info), expiresAt, sequence};
        this.entries.delete(id);
        this.entries.set(id, entry);
        this._prune();
        captured = true;
        return true;
      } catch (_) { return false; }
    };
    return {args: ['--no-simulate', '--print-to-file', 'before_dl:%()j', file],
      sourceArgs, reused: false, capture, invalidate, cleanup};
  }
}
