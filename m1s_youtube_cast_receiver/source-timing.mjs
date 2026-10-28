import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER = 'M1S_TIMING_BEFORE_DOWNLOAD!';

// Use an already-created regular file, never reopen Node's subprocess descriptors.
// The exclamation mark makes the template literal text rather than a yt-dlp metadata field.
export function createSourceTimingFile(log = () => {}) {
  let directory;
  let file;
  const cleanup = () => {
    try { if (file) fs.unlinkSync(file); } catch (_) {}
    try { if (directory) fs.rmdirSync(directory); } catch (_) {}
  };
  try {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'm1s-source-timing-'));
    file = path.join(directory, 'before-download.txt');
    fs.writeFileSync(file, '', {mode:0o600});
    return {path:file, cleanup, args:[
      '--no-simulate', '--print-to-file', `before_dl:${MARKER}`, file
    ]};
  } catch (_) {
    cleanup();
    log('info', '[TIMING][PIPELINE] diagnostic_file_unavailable=true; source runs without marker');
    return {path:null,args:[],cleanup:() => {}};
  }
}

export function observeSourceTiming({ytdlp, ffmpeg, diagnosticFile, startedAt, label, log, now = Date.now}) {
  let downloadAt = null;
  let firstByteAt = null;
  let firstPcmAt = null;
  const report = fields => log('info', `[TIMING][PIPELINE] ${label} ${fields}`);
  const readMarker = () => {
    if (!diagnosticFile?.path || downloadAt !== null) return;
    try {
      if (fs.readFileSync(diagnosticFile.path,'utf8').includes(MARKER)) {
        downloadAt = now();
        report(`ytdlp_before_download_ms=${downloadAt - startedAt} marker_poll_resolution_ms=50`);
      }
    } catch (_) { /* Diagnostics must not interrupt audio on a file read error. */ }
  };
  if (diagnosticFile?.path) fs.watchFile(diagnosticFile.path,{interval:50,persistent:false},readMarker);
  ytdlp.once('spawn', () => report(`ytdlp_spawn_ms=${now() - startedAt}`));
  ffmpeg.once('spawn', () => report(`ffmpeg_spawn_ms=${now() - startedAt}`));
  // The existing pipe stays responsible for transport and backpressure.
  ytdlp.stdout.once('data', chunk => {
    readMarker();
    firstByteAt = now();
    report(`first_audio_pipe_byte_ms=${firstByteAt - startedAt} download_to_first_byte_ms=${downloadAt === null ? 'unknown' : firstByteAt - downloadAt} first_chunk_bytes=${chunk.length}`);
  });
  ytdlp.once('close', (code,signal) => {
    readMarker();
    if (diagnosticFile?.path) fs.unwatchFile(diagnosticFile.path,readMarker);
    diagnosticFile?.cleanup();
    report(`ytdlp_close_ms=${now() - startedAt} code=${code} signal=${signal || 'none'}`);
  });
  ffmpeg.once('close', (code,signal) => report(`ffmpeg_close_ms=${now() - startedAt} code=${code} signal=${signal || 'none'}`));
  return {
    firstPcm() {
      if (firstPcmAt !== null) return;
      firstPcmAt = now();
      report(`first_pcm_ms=${firstPcmAt - startedAt} pipe_to_pcm_ms=${firstByteAt === null ? 'unknown' : firstPcmAt - firstByteAt}`);
    }
  };
}
