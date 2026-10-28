import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PreparedSourceCache} from '../prepared-source-cache.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'm1s-cache-tests-'));
const leases = [];
let now = 100000;
const cache = new PreparedSourceCache({now: () => now, tmpDir: directory, ttlMs: 1000, maxEntries: 2});
const plan = (id, position = 0) => {const lease = cache.plan(id, position); leases.push(lease); return lease;};
const infoPath = lease => lease.args.at(-1);
const info = (id, extra = {}) => ({id, _type: 'video', title: `Track ${id}`,
  url: 'https://media.example/audio.webm', format_id: '251', ext: 'webm',
  http_headers: {'User-Agent': 'Original client', Referer: 'https://www.youtube.com/'},
  formats: [{format_id: '251', url: 'https://media.example/audio.webm', ext: 'webm', vcodec: 'none'}],
  webpage_url: `https://www.youtube.com/watch?v=${id}`, ...extra});
const write = (lease, value) => fs.writeFileSync(infoPath(lease), JSON.stringify(value));
try {
  const fresh = plan('same-track', 17);
  assert.equal(fresh.reused, false);
  assert.deepEqual(fresh.args.slice(0, 3), ['--no-simulate', '--print-to-file', 'before_dl:%()j']);
  assert.ok(fs.statSync(infoPath(fresh)).isFile());
  assert.deepEqual(fresh.sourceArgs, ['https://www.youtube.com/watch?v=same-track']);
  assert.equal(fresh.capture(), false, 'empty files are not cached');
  fs.writeFileSync(infoPath(fresh), '{');
  assert.equal(fresh.capture(), false, 'incomplete JSON cannot poison cache');
  write(fresh, info('different-track'));
  assert.equal(fresh.capture(), false, 'only metadata for the requested video is reusable');
  write(fresh, info('same-track', {duration:99, artist:'Artist', section_start:17, section_end:99, section_title:'old', section_number:2}));
  assert.equal(fresh.capture(), true);
  assert.deepEqual(cache.displayMetadata('same-track'), {
    title:'Track same-track',artist:'Artist',uploader:'',channel:'',duration:99
  });
  assert.equal(cache.displayMetadata('missing'),null);
  const reused = plan('same-track', 30);
  assert.equal(reused.reused, true);
  assert.deepEqual(reused.sourceArgs, []);
  assert.equal(reused.args[0], '--load-info-json');
  const copied = JSON.parse(fs.readFileSync(infoPath(reused), 'utf8'));
  assert.equal(copied.url, 'https://media.example/audio.webm');
  assert.deepEqual(copied.http_headers, info('same-track').http_headers);
  assert.deepEqual(copied.formats, info('same-track').formats);
  for (const key of ['section_start','section_end','section_title','section_number','webpage_url']) assert.ok(!(key in copied));
  const copiedPath = infoPath(reused);
  fresh.cleanup();
  assert.ok(fs.existsSync(copiedPath), 'old cleanup cannot remove a reused attempt copy');
  reused.cleanup();
  assert.ok(!fs.existsSync(copiedPath));
  assert.equal(plan('same-track', 0).reused, true, 'seeking back to zero reuses the full source');
  now += 1001;
  assert.equal(cache.displayMetadata('same-track'),null,'expired source metadata is not published');
  assert.equal(plan('same-track', 10).reused, false, 'TTL requires fresh extraction');

  const first = plan('identity'); write(first, info('identity')); assert.ok(first.capture());
  const old = plan('identity'); old.invalidate();
  const newer = plan('identity'); write(newer, info('identity', {title:'new'})); assert.ok(newer.capture());
  old.invalidate();
  assert.equal(plan('identity').reused, true, 'old invalidation cannot erase replacement metadata');
  const olderCapture = plan('late');
  const newerCapture = plan('late'); write(newerCapture, info('late', {title:'newer'})); assert.ok(newerCapture.capture());
  write(olderCapture, info('late', {title:'older'}));
  assert.equal(olderCapture.capture(), false, 'old completion cannot overwrite a newer cache entry');
  assert.equal(JSON.parse(fs.readFileSync(infoPath(plan('late')), 'utf8')).title, 'newer');

  cache.clear();
  for (const id of ['one', 'two']) {const lease = plan(id); write(lease, info(id)); assert.ok(lease.capture());}
  assert.equal(plan('one').reused, true, 'access marks an entry as recently used');
  const third = plan('three'); write(third, info('three')); assert.ok(third.capture());
  assert.equal(plan('two').reused, false, 'bounded LRU evicts the least recently used video');

  const expiryCache = new PreparedSourceCache({now: () => now, tmpDir: directory});
  const expiring = expiryCache.plan('signed'); leases.push(expiring);
  write(expiring, info('signed', {url:'https://media.example/a?expire=1700000000'}));
  now = 1699999960000;
  assert.ok(expiring.capture());
  now = 1699999970001;
  const expired = expiryCache.plan('signed'); leases.push(expired);
  assert.equal(expired.reused, false, 'signed URL expiry minus safety margin caps TTL');

  const bad = new PreparedSourceCache({tmpDir:path.join(directory, 'does-not-exist')}).plan('fallback');
  assert.equal(bad.reused, false);
  assert.deepEqual(bad.args, []);
  assert.equal(bad.capture(), false);
  assert.ok(bad.sourceArgs[0].endsWith('fallback'), 'cache filesystem errors retain normal extraction');
  bad.cleanup();
  console.log('PASS: prepared-source identity, protected per-attempt files, seek reset, TTL/LRU, signed expiry, stale invalidation, partial JSON and filesystem fallback.');
} finally {
  for (const lease of leases) lease.cleanup();
  assert.deepEqual(fs.readdirSync(directory), [], 'every private attempt file and directory is cleaned');
  fs.rmdirSync(directory);
}
