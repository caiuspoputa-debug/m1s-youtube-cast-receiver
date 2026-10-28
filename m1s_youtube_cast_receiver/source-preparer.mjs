import {spawn as spawnProcess} from 'node:child_process';

const AUDIO_FORMAT = 'bestaudio[ext=webm]/bestaudio';

/** Prepare selected source metadata only; playback keeps its existing cold fallback. */
export class SourcePreparer {
  constructor({cache, ytdlp = '/opt/yt-dlp/bin/yt-dlp', log = () => {}, label = '',
    timeoutMs = 20000, retryMs = 30000, killGraceMs = 1500,
    spawn = spawnProcess, now = Date.now} = {}) {
    if (!cache || typeof cache.plan !== 'function') throw new TypeError('A prepared source cache is required');
    this.cache = cache;
    this.ytdlp = ytdlp;
    this.log = log;
    this.label = label;
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 20000);
    this.retryMs = Math.max(0, Number(retryMs) || 0);
    this.killGraceMs = Math.max(1, Number(killGraceMs) || 1500);
    this.spawn = spawn;
    this.now = now;
    this.current = null;
    this.failures = new Map();
  }

  _report(level, id, fields) {
    this.log(level, `[TIMING][PREFETCH] ${this.label} video=${id} ${fields}`);
  }

  _stop(job, reason) {
    if (!job || job.done) return;
    job.reason = reason;
    try { job.child?.kill('SIGTERM'); } catch (_) {}
    if (!job.done) {
      job.killTimer = setTimeout(() => {
        try { job.child?.kill('SIGKILL'); } catch (_) {}
        job.finish(false);
      }, this.killGraceMs);
      job.killTimer.unref?.();
    }
  }

  cancel() {
    const job = this.current;
    if (!job) return;
    this.current = null;
    job.cancelled = true;
    // Its file is private to this attempt. It must not outlive cancellation.
    try { job.plan.cleanup(); } catch (_) {}
    this._stop(job, 'cancelled');
  }

  prepare(videoId) {
    const id = String(videoId || '');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {this.cancel(); return Promise.resolve(false);}
    if (this.current?.id === id) return this.current.promise;
    this.cancel();
    if (this.cache.has?.(id)) return Promise.resolve(true);
    const failedAt = this.failures.get(id);
    if (failedAt !== undefined && this.now() - failedAt < this.retryMs) return Promise.resolve(false);

    let plan;
    try { plan = this.cache.plan(id, 0); } catch (_) {return Promise.resolve(false);}
    if (plan.reused) {plan.cleanup(); return Promise.resolve(true);}
    if (!plan.args.length) {plan.cleanup(); return Promise.resolve(false);}

    const job = {id, plan, startedAt: this.now(), child: null, done: false,
      cancelled: false, reason: null, timer: null, killTimer: null};
    job.promise = new Promise(resolve => {job.resolve = resolve;});
    job.finish = success => {
      if (job.done) return;
      job.done = true;
      clearTimeout(job.timer); clearTimeout(job.killTimer);
      let ready = false;
      if (success && !job.cancelled) {
        try {ready = Boolean(plan.capture());} catch (_) {}
      }
      try {plan.cleanup();} catch (_) {}
      if (this.current === job) this.current = null;
      const elapsed = Math.max(0, this.now() - job.startedAt);
      if (job.cancelled) {
        this._report('debug', id, `cancelled=true elapsed_ms=${elapsed}`);
      } else if (ready) {
        this.failures.delete(id);
        this._report('info', id, `ready=true elapsed_ms=${elapsed}`);
      } else {
        this.failures.delete(id); this.failures.set(id, this.now());
        while (this.failures.size > 8) this.failures.delete(this.failures.keys().next().value);
        this._report('info', id, `ready=false elapsed_ms=${elapsed} reason=${job.reason || 'source_failed'} cold_fallback=true`);
      }
      job.resolve(ready);
    };
    this.current = job;
    const args = ['--no-playlist', '--quiet', '--no-warnings', '--js-runtimes', 'node',
      ...plan.args, '-f', AUDIO_FORMAT, '-o', '-', '--skip-download', ...plan.sourceArgs];
    try {
      job.child = this.spawn(this.ytdlp, args, {stdio: ['ignore', 'ignore', 'pipe']});
      // Never copy extractor messages (which may contain signed URLs) to logs.
      job.child.stderr?.on('data', () => {});
      job.child.once('error', () => {job.reason = 'spawn_error'; job.finish(false);});
      job.child.once('close', code => job.finish(code === 0));
      job.timer = setTimeout(() => this._stop(job, 'timeout'), this.timeoutMs);
      job.timer.unref?.();
    } catch (_) {
      job.reason = 'spawn_error'; job.finish(false);
    }
    return job.promise;
  }
}
