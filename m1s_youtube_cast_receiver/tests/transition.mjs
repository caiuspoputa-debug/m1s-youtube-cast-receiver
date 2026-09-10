import fs from 'node:fs';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { randomUUID } from 'node:crypto';
import Playlist from '../node_modules/yt-cast-receiver/dist/lib/app/Playlist.js';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
const dependency = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/Player.js', import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export default Player;','');
const Player = new Function('EventEmitter','uuidv4','AUTOPLAY_MODES','PLAYER_STATUSES','Playlist',dependency+'\nreturn Player;')
  (EventEmitter,randomUUID,Constants.AUTOPLAY_MODES,Constants.PLAYER_STATUSES,Playlist);
const logger={debug(){},info(){},warn(){},error(){}};
const S=Constants.PLAYER_STATUSES;
function load(relative) {
  const source=fs.readFileSync(new URL(relative,import.meta.url),'utf8');
  const code=source.slice(source.indexOf('class M1SPlayer extends Player {'),source.indexOf('\nasync function initializeVolume'));
  return new Function('Player','Constants','log','sleep',code+'\nreturn M1SPlayer;')(Player,Constants,()=>{},async()=>{});
}
async function setup(Type) {
  const p=new Type({name:'Test',entityId:'media_player.test'});
  p.setLogger(logger);p.queue.setLogger(logger);
  p.targetStillOwnedByYoutube=async()=>true;
  p.stops=0;p.doStop=async()=>{p.stops++;p.playGeneration++;p.startedAt=null;return true;};
  p.doPlay=async(video,pos)=>{p.currentVideo=video;p.currentVideoId=video.id;p.duration=207;p.basePosition=pos;p.startedAt=Date.now();return true;};
  await p.play({id:'a'},0);
  p.continuousSession={active:true};p.ownsTarget=true;
  const states=[];p.on('state',e=>states.push(e.current));
  return {p,states};
}
const Fixed=load('../index.mjs');
const {p,states}=await setup(Fixed);
p.basePosition=303;p.duration=299;
await p.play({id:'b'},0);
assert.deepEqual(states.map(s=>s.status),[S.LOADING,S.PLAYING]);
assert.equal(states[0].position,0);assert.equal(states[0].duration,0);assert.equal(p.stops,0);
await p.stop();assert.equal(p.stops,1);assert.equal(p.status,S.STOPPED);
// A Stop during pending replacement must not be swallowed by the internal flag.
await p.play({id:'a'},0);let finish;
p.doPlay=async()=>{const gen=p.playGeneration;await new Promise(r=>finish=r);return gen===p.playGeneration;};
const pending=p.play({id:'b'},0);
while(!finish)await Promise.resolve();
await p.stop();assert.equal(p.stops,2);finish();await pending;assert.equal(p.status,S.STOPPED);
// Exercise real base seek/resume + actual M1S doSeek/doResume with controlled PCM starts.
const seek=await setup(Fixed);const q=seek.p;const output=[];const queued=[];
q.continuousSession={active:true,transportLeadMs:0,pause(){},
  queueTrack:async(id,pos)=>{queued.push(pos);return queued.length;},
  waitTrackOutputStart:gen=>new Promise(r=>output[gen]=r)};
await q.pause();assert.equal(q.status,S.PAUSED);
const resume=q.resume();while(!output[1])await Promise.resolve();
const seeking=q.seek(120);while(!output[2])await Promise.resolve();
output[2](Date.now());await seeking;output[1](Date.now());await resume;
assert.equal(queued.length,2,'seek follow-up resume must not start third decoder');
assert.equal(q.status,S.PLAYING);assert.equal(q.basePosition,120);assert.equal(q.stops,0);
assert.ok(!seek.states.some(s=>s.status===S.STOPPED));
// Ordinary seek retains the existing transport, and pause/resume still works.
const same=q.continuousSession;const direct=q.seek(60);while(!output[3])await Promise.resolve();output[3](Date.now());await direct;
assert.equal(q.continuousSession,same);assert.equal(q.basePosition,60);
await q.pause();const r=q.resume();while(!output[4])await Promise.resolve();output[4](Date.now());await r;
assert.equal(q.status,S.PLAYING);assert.equal(queued.length,4);
const natural=await setup(Fixed);const n=natural.p;
n.continuousSession.currentTrackGeneration=1;
n.queue.next=async()=>({id:'next'});
await n.handleContinuousSourceEof('a',1);
assert.deepEqual(natural.states.map(s=>s.status),[S.LOADING,S.PLAYING]);
assert.equal(n.currentVideoId,'next');assert.equal(n.stops,0);
console.log('PASS: actual pinned Player: fixed replacement sends LOADING/PLAYING with fresh timing; explicit Stop during loading works; play+seek does not start a third decoder; seek and pause/resume preserve transport.');
const {isMusicSender}=await import('../music-start.mjs');
assert.equal(isMusicSender([{client:{key:'YTMUSIC'}}],{key:'YT'}),true);
assert.equal(isMusicSender([{client:{key:'YT'}}],{key:'YT'}),false);
assert.equal(isMusicSender([{client:{key:'YT'}},{client:{key:'YTMUSIC'}}],{key:'YT'}),false);
const music=await setup(Fixed);const m=music.p;m.musicSenderActive=true;
let starts=0,release;
m.doPlay=async()=>{starts++;await new Promise(r=>release=r);return true;};
const first=m.play({id:'music'},0);
while(!release) await Promise.resolve();
const duplicate=m.play({id:'music'},0);const resumeLoading=m.resume();
await Promise.resolve();assert.equal(starts,1);release();await Promise.all([first,duplicate,resumeLoading]);
assert.equal(m.status,S.PLAYING);assert.equal(m.stops,0);
release=null;const one=m.play({id:'one'},0);while(!release)await Promise.resolve();
const releaseFirst=release;const two=m.play({id:'two'},0);await Promise.resolve();assert.equal(starts,2);
release=null;releaseFirst();await one;while(!release)await Promise.resolve();assert.equal(starts,3);release();await two;
let attempts=0;m.playSelected=async()=>{attempts++;return true;};
const cancelled=m.play({id:'cancel'},0);await m.stop();assert.equal(await cancelled,false);assert.equal(attempts,0);
// Normal YouTube bypasses the new startup queue entirely.
const yt=await setup(Fixed);let immediate=0;
yt.p.playSelected=()=>{immediate++;return true;};const unchanged=yt.p.play({id:'yt'},0);
assert.equal(immediate,1);assert.equal(yt.p.pendingPlay,null);await unchanged;
console.log('PASS: YTM sender classification; duplicate Play/resume coalesced; distinct starts serialized; Stop cancels pending work; ordinary YouTube bypasses new guard.');
const volumeTest=await setup(Fixed);const v=volumeTest.p;v.volume={level:6,muted:false};
const levels=[];
v.doSetVolume=async value=>{levels.push(value.level);v.volume={...value};return true;};
await v.setPhoneVolume({level:9,muted:false});assert.equal(v.volume.level,7);
await v.setPhoneVolume({level:4,muted:false});assert.equal(v.volume.level,6);
await Promise.all([v.setPhoneVolume({level:20}),v.setPhoneVolume({level:20})]);
assert.deepEqual(levels,[7,6,7,8]);
await v.setPhoneVolume({level:NaN,muted:true});assert.equal(v.volume.level,8);assert.equal(v.volume.muted,false);
v.volume.muted=true;await v.setPhoneVolume({level:8,muted:false});assert.equal(v.volume.muted,true);
v.volume.level=0;await v.setPhoneVolume({level:-3});assert.equal(v.volume.level,0);
v.volume.level=100;await v.setPhoneVolume({level:103});assert.equal(v.volume.level,100);
await v.setVolume({level:37,muted:false});assert.equal(v.volume.level,37);
console.log('PASS: phone volume steps +/-1, ordered rapid commands, HA-owned mute and boundaries; non-phone absolute setVolume unchanged.');
const refresh=await setup(Fixed);const f=refresh.p;f.musicSenderActive=true;
f.continuousSession={active:true};f.ownsTarget=true;f.startedAt=Date.now();
f.noteSenderConnected({id:'music-phone'});
while(f.progressPublishing)await Promise.resolve();
assert.equal(f.connectedSenderIds.size,1);
let snapshots=[];f.on('state',event=>snapshots.push(event));
await f.publishProgress();assert.equal(snapshots.length,1);assert.equal(snapshots[0].previous,null);
assert.equal(snapshots[0].current.status,S.PLAYING);assert.equal(snapshots[0].current.duration,207);
await f.notifyExternalStateChange(S.PAUSED);f.paused=true;f.startedAt=null;snapshots=[];
await f.publishProgress();assert.equal(snapshots[0].current.status,S.PAUSED);assert.equal(snapshots[0].previous,null);
const count=snapshots.length;let finishState;f.getState=()=>new Promise(r=>finishState=r);
const stale=f.publishProgress();f.playGeneration++;finishState({status:S.PAUSED});await stale;
assert.equal(snapshots.length,count);
console.log('PASS: YTM initial sender tracking, full playing/paused snapshots, stale state rejection.');
