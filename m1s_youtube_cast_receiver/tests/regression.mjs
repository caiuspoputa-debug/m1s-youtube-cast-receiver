import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createQueueHandler } from '../queue-handler.mjs';
import Playlist from '../node_modules/yt-cast-receiver/dist/lib/app/Playlist.js';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
import PlaylistRequestHandler from '../node_modules/yt-cast-receiver/dist/lib/app/PlaylistRequestHandler.js';
let remoteCalls=0;
class BrokenRemote extends PlaylistRequestHandler {
 async getPreviousNextVideos(){remoteCalls++;return {previous:null,next:null};}
}
const logger={debug(){},info(){},warn(){},error(){}};
const Handler=createQueueHandler(BrokenRemote,Constants.AUTOPLAY_MODES.ENABLED);
const q=new Playlist();q.setLogger(logger);const handler=new Handler();handler.setLogger(logger);q.setRequestHandler(handler);
const client={key:'YT'};
const [videoA,videoB,videoC]=['AAAAAAAAAAA','BBBBBBBBBBB','CCCCCCCCCCC'];
await q.updateByMessage({name:'setPlaylist',payload:{listId:'test',videoIds:[videoA,videoB,videoC].join(','),videoId:videoA,currentIndex:'0'}},client);
assert.equal(q.hasNext,true);assert.equal(q.getState().next.id,videoB);assert.equal(q.hasPrevious,false);
assert.equal((await q.next()).id,videoB);assert.equal(q.hasPrevious,true);assert.equal(q.getState().next.id,videoC);
assert.equal((await q.previous()).id,videoA);await q.next();await q.next();assert.equal(q.hasNext,false);assert.equal(await q.next(),null);assert.equal(remoteCalls,0);
// Enabled autoplay at end still uses remote recommendations, not a loop to item 1.
await q.setAutoplayMode(Constants.AUTOPLAY_MODES.ENABLED);assert.equal(remoteCalls,1);assert.equal(q.autoplay,null);
const code=fs.readFileSync(new URL('../index.mjs', import.meta.url),'utf8');
const classText=code.slice(code.indexOf('class M1SPlayer extends Player {'),code.indexOf('\nasync function initializeVolume'));
let slept=[];
const sleep=async ms=>{slept.push(ms);};
class Base {constructor(){this.status=Constants.PLAYER_STATUSES.PLAYING;}}
const M1S=new Function('Player','Constants','log','sleep',classText+';return M1SPlayer;')(Base,Constants,()=>{},sleep);
const p=new M1S({name:'Test',isGroup:false});
p.expectedStreamPath=()=>'/stream/test/1.wav';
let reads=0;p.readTargetPlaybackState=async()=>{reads++;return {mediaId:'http://host/stream/test/1.wav',state:'playing',transportStartedSerial:NaN,singlePrebufferSeconds:2.5};};
const transport=await p.waitForTransportStarted(1);assert.equal(transport.exact,false);assert.equal(transport.fallbackLeadMs,2500);assert.equal(reads,1);assert.deepEqual(slept,[]);
p.readTargetPlaybackState=async()=>({mediaId:'http://host/stream/test/1.wav',state:'playing',transportStartedSerial:1});assert.equal((await p.waitForTransportStarted(1)).exact,true);
p.readTargetPlaybackState=async()=>({mediaId:'http://radio',state:'playing',transportStartedSerial:NaN});await assert.rejects(()=>p.waitForTransportStarted(1),/source changed/);
// EOF must wait for output drain; a user source switch must invalidate that stop.
let drainResolve;let stops=0;
const session={active:true,currentTrackGeneration:1,transportLeadMs:0,waitTrackOutputDrain:()=>new Promise(r=>{drainResolve=r;})};
p.continuousSession=session;p.currentVideoId='a';p.queue={isUpdating:false,getState:()=>({next:null}),next:async()=>null};p.autoplayMode=Constants.AUTOPLAY_MODES.DISABLED;p.targetStillOwnedByYoutube=async()=>true;p.stop=async()=>{stops++;};
let eof=p.handleContinuousSourceEof('a',1);for(let i=0;i<4;i++)await Promise.resolve();assert.equal(stops,0);assert.ok(drainResolve);drainResolve(Date.now());await eof;assert.equal(stops,1);
eof=p.handleContinuousSourceEof('a',1);for(let i=0;i<4;i++)await Promise.resolve();session.currentTrackGeneration=2;drainResolve(Date.now());await eof;assert.equal(stops,1);
// Actual staged-successor PCM and state-boundary behavior is exercised by natural-handoff.mjs.
// Reconnection publishes state but never alters playback status/transport.
p.ownsTarget=true;p.startedAt=Date.now()-10000;p.connectedSenderIds.add('phone');let updates=0;
p.queue.current={id:p.currentVideoId};
p.getState=async()=>({status:p.status,queue:{current:{id:p.currentVideoId}},position:10,duration:100,volume:{level:5,muted:false}});
p.emit=(event,snapshot)=>{assert.equal(event,'state');assert.equal(snapshot.previous,null);updates++;};
await p.publishProgress();assert.equal(updates,1);p.status=Constants.PLAYER_STATUSES.LOADING;await p.publishProgress();assert.equal(updates,1);p.status=Constants.PLAYER_STATUSES.PLAYING;p.connectedSenderIds.clear();await p.publishProgress();assert.equal(updates,1);
p.startProgressUpdates();const timer=p.progressTimer;p.startProgressUpdates();assert.equal(p.progressTimer,timer);p.stopProgressUpdates();assert.equal(p.progressTimer,null);
console.log('PASS: real library queue navigation with broken remote endpoints; autoplay boundary; immediate startup fallback; exact serial/source change; EOF drain and stale-stop guard; next inside one session; progress publication and timer lifecycle.');
