import assert from 'node:assert/strict';
import fs from 'node:fs';
import Player from '../node_modules/yt-cast-receiver/dist/lib/Player.js';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';

const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('class M1SPlayer extends Player {'), source.indexOf('\nasync function initializeVolume'));
const logging = source.slice(source.indexOf('function installQueueLogging('), source.indexOf('\nreceiverDefinitions = await discoverReceiverDefinitions();'));
const calls = [], timers = [];
class SourcePreparer {
  prepare(id) {calls.push(['prepare', id]); return Promise.resolve(true);}
  cancel() {calls.push(['cancel']);}
}
const logger = {debug() {}, info() {}, warn() {}, error() {}};
const {Type, installQueueLogging} = new Function('Player', 'Constants', 'SourcePreparer',
  'NEXT_SOURCE_PREPARE_AHEAD_SECONDS', 'preparedSources', 'YTDLP', 'safeVideoId', 'log', 'setInterval', 'clearInterval',
  `${code}\n${logging}\nreturn {Type:M1SPlayer,installQueueLogging};`)(Player, Constants, SourcePreparer, 30, {}, 'downloader',
  id => /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null, () => {},
  (callback, period) => {const timer={callback, period, unref() {}};timers.push(timer);return timer;}, () => {});

const A='AAAAAAAAAAA', B='BBBBBBBBBBB', C='CCCCCCCCCCC';
const p = new Type({name:'Prefetch timing', key:'test'});
p.setLogger(logger); p.queue.setLogger(logger);
p.queue.setRequestHandler({getPreviousNextVideosAbortable:async (target, playlist) => {
  const i=playlist.videoIds.indexOf(target.id);
  return {previous:null,next:playlist.videoIds[i+1] ? {id:playlist.videoIds[i+1]} : null};
}});
const select = async ids => p.queue.updateByMessage({name:'setPlaylist',payload:{
  listId:'explicit',videoId:A,videoIds:ids.join(','),currentIndex:'0'
}}, {key:'YT'});
await select([A,B]);
p.currentVideoId=A;p.currentVideo={id:A};p.title='Current A';p.duration=120;
p.basePosition=20;p.startedAt=null;p.playGeneration=7;p.ownsTarget=true;
p.continuousSession={active:true,queueTrack() {throw Error('Preparation must not queue audio');},stop() {throw Error('Preparation must not stop transport');}};
await p.notifyExternalStateChange(Constants.PLAYER_STATUSES.PLAYING);
const states=[];p.on('state', e=>states.push(e));
const sameSession=p.continuousSession;

assert.equal(await p.refreshNextSourcePreparation(),false);
assert.equal(p.nextSourcePreparer,null,'long remaining duration does not start early expiring extraction');
p.basePosition=90;
assert.equal(await p.refreshNextSourcePreparation(),true);
assert.deepEqual(calls.at(-1),['prepare',B]);
assert.equal(p.queue.current.id,A);assert.equal(p.currentVideoId,A);
assert.equal(p.title,'Current A');assert.equal(p.duration,120);assert.equal(p.basePosition,90);
assert.equal(p.playGeneration,7);assert.equal(p.continuousSession,sameSession);
assert.equal(p.status,Constants.PLAYER_STATUSES.PLAYING);assert.deepEqual(states,[]);

installQueueLogging(p);
await select([A,C]);
assert.deepEqual(calls.at(-1),['prepare',C],'real playlist event prepares the changed successor');
assert.ok(calls.some(c=>c[0]==='cancel'));
p.invalidateNaturalHandoff();
assert.equal(p.nextPreparedCandidateId,null);assert.deepEqual(calls.at(-1),['cancel']);

p.duration=1592;p.basePosition=0;
const beforeLong=calls.filter(c=>c[0]==='prepare').length;
await p.refreshNextSourcePreparation();
assert.equal(calls.filter(c=>c[0]==='prepare').length,beforeLong);
p.basePosition=1565;await p.refreshNextSourcePreparation();
assert.deepEqual(calls.at(-1),['prepare',C],'26-minute track prepares near its actual end');
p.paused=true;assert.equal(await p.refreshNextSourcePreparation(),false);
assert.deepEqual(calls.at(-1),['cancel']);
p.paused=false;p.duration=0;await p.refreshNextSourcePreparation();
assert.deepEqual(calls.at(-1),['prepare',C]);assert.equal(p.duration,0,'unknown duration is not invented');

p.startProgressUpdates();
assert.equal(timers.length,1);assert.equal(timers[0].period,5000,'reuse existing progress interval');
const beforePoll=calls.filter(c=>c[0]==='prepare').length;
timers[0].callback();
assert.equal(calls.filter(c=>c[0]==='prepare').length,beforePoll+1);
p.sessionRelinquished=true;assert.equal(await p.refreshNextSourcePreparation(),false);
assert.deepEqual(calls.at(-1),['cancel']);
p.stopProgressUpdates();
console.log('PASS: successor metadata prepares near end on the existing progress interval and real queue changes; manual cancellation, unknown/long tracks, public clock, queue and audio transport remain independent.');
