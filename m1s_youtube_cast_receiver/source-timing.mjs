// Diagnostic output goes to stderr only; stdout remains the unmodified audio pipe.
export const SOURCE_TIMING_ARGS = [
  '--no-simulate',
  '--print-to-file', 'before_dl:__M1S_TIMING_BEFORE_DOWNLOAD__', '/dev/stderr'
];

export function observeSourceTiming({ytdlp, ffmpeg, startedAt, label, log, now = Date.now}) {
  let downloadAt = null;
  let firstByteAt = null;
  let firstPcmAt = null;
  let stderrTail = '';
  const report = fields => log('info', `[TIMING][PIPELINE] ${label} ${fields}`);
  ytdlp.once('spawn', () => report(`ytdlp_spawn_ms=${now() - startedAt}`));
  ffmpeg.once('spawn', () => report(`ffmpeg_spawn_ms=${now() - startedAt}`));
  ytdlp.stderr.on('data', chunk => {
    if (downloadAt !== null) return;
    stderrTail = (stderrTail + chunk.toString()).slice(-512);
    if (stderrTail.includes('__M1S_TIMING_BEFORE_DOWNLOAD__')) {
      downloadAt = now();
      report(`ytdlp_before_download_ms=${downloadAt - startedAt}`);
    }
  });
  // The existing pipe stays responsible for transport and backpressure.
  ytdlp.stdout.once('data', chunk => {
    firstByteAt = now();
    report(`first_audio_pipe_byte_ms=${firstByteAt - startedAt} download_to_first_byte_ms=${downloadAt === null ? 'unknown' : firstByteAt - downloadAt} first_chunk_bytes=${chunk.length}`);
  });
  ytdlp.once('close', (code,signal) => report(`ytdlp_close_ms=${now() - startedAt} code=${code} signal=${signal || 'none'}`));
  ffmpeg.once('close', (code,signal) => report(`ffmpeg_close_ms=${now() - startedAt} code=${code} signal=${signal || 'none'}`));
  return {
    firstPcm() {
      if (firstPcmAt !== null) return;
      firstPcmAt = now();
      report(`first_pcm_ms=${firstPcmAt - startedAt} pipe_to_pcm_ms=${firstByteAt === null ? 'unknown' : firstPcmAt - firstByteAt}`);
    }
  };
}
