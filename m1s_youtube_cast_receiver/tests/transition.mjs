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
