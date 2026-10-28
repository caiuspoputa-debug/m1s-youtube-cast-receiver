import fs from 'node:fs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const PCM_RATE ='), source.indexOf('\nfunction nextStreamSerial'));
const logs=[];
const make = new Function('streamHost','cfg','safeVideoId','log','sleep','observeSourceTiming', code+'\nreturn {ContinuousAudioSession, PCM_CHUNK_BYTES};');
const {ContinuousAudioSession: Session,PCM_CHUNK_BYTES: bytes} = make('lan', {audioPort:9000}, x=>x, (...a)=>logs.push(a), delay, ()=>({firstPcm(){}}));
let session;
const player={definition:{name:'test',key:'test'},handleContinuousSourceEof: async id=> {
  if (id==='first') await session.queueTrack('second',0,{append:true});
}};
session = new Session(player,1);
let killed=0;
const fixture1=Buffer.concat(Array.from({length:80},(_,i)=>Buffer.alloc(bytes, i+1)).concat([Buffer.from([101,102,103,104])]));
const fixture2=Buffer.concat(Array.from({length:10},(_,i)=>Buffer.alloc(bytes, 200+i)));
const expected1 = Buffer.concat([fixture1,Buffer.alloc(bytes-4)]);
const expected=Buffer.concat([expected1,fixture2]);
session._spawnTrackProcesses = id => {
  const child = ()=>Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,killed:false,kill(){killed++;this.killed=true;}});
  const ytdlp=child(),ffmpeg=child();
  session.sourceChildren.add(ytdlp);session.sourceChildren.add(ffmpeg);
  setImmediate(()=>{
    const data=id==='first'?fixture1:fixture2;
    // Simulate decoder packet boundaries unrelated to PCM period boundaries.
    for(let at=0;at<data.length;at+=6151) ffmpeg.stdout.write(data.subarray(at,at+6151));
    ffmpeg.stdout.end();
    ytdlp.exitCode=0;ffmpeg.exitCode=0;
    ytdlp.emit('close',0);ffmpeg.emit('close',0);
  });
  return {ytdlp,ffmpeg,sourcePlan:{invalidate(){},reused:false}};
};
let actual=[];
session._pace=()=>delay(1);
session._writeChunk=async chunk=>{
  // Ignore only synthetic silence; all fixture periods have nonzero first byte.
  if (chunk[0]) actual.push(chunk);
  if (actual.length === expected.length/bytes) {session.active=false;session._wakeSpace();}
};
session.clientReady.resolve();session.response={destroyed:false,writableEnded:false};
await session.queueTrack('first');
await session._outputLoop();
await Promise.all(session.sourceTasks);
assert.deepEqual(Buffer.concat(actual),expected,'natural append preserves every old-tail and successor byte in order');
assert.equal(killed,0,'natural append does not terminate children');
console.log(`PASS: all ${expected.length} bytes retained through real _decodeTrackAttempt, PCM packet assembly, source EOF, append and output loop; partial last period padded once; no children killed.`);
