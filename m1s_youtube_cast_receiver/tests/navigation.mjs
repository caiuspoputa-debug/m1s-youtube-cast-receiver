import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractNavigation } from '../next-navigation.mjs';
import Playlist from '../node_modules/yt-cast-receiver/dist/lib/app/Playlist.js';
import Constants from '../node_modules/yt-cast-receiver/dist/lib/Constants.js';
import PlaylistRequestHandler from '../node_modules/yt-cast-receiver/dist/lib/app/PlaylistRequestHandler.js';
const ep=id=>({watchEndpoint:{videoId:id}});
const web={contents:{twoColumnWatchNextResults:{secondaryResults:{secondaryResults:{results:[
  {compactVideoRenderer:{navigationEndpoint:ep('not-autoplay')}},
  {compactAutoplayRenderer:{contents:[{compactVideoRenderer:{navigationEndpoint:ep('next')}}]}}
]}}}}};
assert.equal(extractNavigation(web).autoplay.watchEndpoint.videoId,'next');
assert.equal(extractNavigation({contents:{twoColumnWatchNextResults:{secondaryResults:{secondaryResults:{results:[{compactVideoRenderer:{navigationEndpoint:ep('random')}}]}}}}}).autoplay,null);
assert.equal(extractNavigation({playerOverlays:{playerOverlayRenderer:{autoplay:{playerOverlayAutoplayRenderer:{nextButton:{buttonRenderer:{navigationEndpoint:ep('overlay')}}}}}}}).autoplay.watchEndpoint.videoId,'overlay');
const tv={contents:{singleColumnWatchNextResults:{autoplay:{autoplay:{sets:[{nextVideoRenderer:{autoplayEndpointRenderer:{endpoint:ep('tv')}}}]}}}}};
assert.equal(extractNavigation(tv).next.watchEndpoint.videoId,'tv');
// Execute the patched dependency's real resolver against controlled TV/WEB responses.
const logger={debug(){},info(){},warn(){},error(){}};
let calls=0;
const innertube={session:{context:{client:{clientName:'WEB'},user:{}}},actions:{execute:async()=>({data:++calls===1?{}:web})}};
const lib={Constants:{CLIENTS:{YTMUSIC:{NAME:'WEB_REMIX',VERSION:'test'}}},YTNodes:{NavigationEndpoint:class{constructor(v){this.payload=v.watchEndpoint||{};}}}};
let code=fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/DefaultPlaylistRequestHandler.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default DefaultPlaylistRequestHandler;','');
const Handler=new Function('Innertube','InnertubeLib','CLIENTS','PlaylistRequestHandler','extractNavigation',code+'\nreturn DefaultPlaylistRequestHandler;')({create:async()=>innertube},lib,Constants.CLIENTS,PlaylistRequestHandler,extractNavigation);
const h=new Handler();h.setLogger(logger);h.markWatched=async()=>{};
const resolved=await h.getPreviousNextVideos({id:'current',client:Constants.CLIENTS.YT},{videoIds:['current']});
assert.equal(resolved.next.id,'next');assert.equal(calls,2);
// Actual Playlist hides hasNext at the last explicit row, despite a valid autoplay.
const source=fs.readFileSync(new URL('../index.mjs',import.meta.url),'utf8');
const method=source.slice(source.indexOf('  getNavInfo() {'),source.indexOf('\n  async next(AID)',source.indexOf('  getNavInfo() {')));
class Base {getNavInfo(){return {hasPrevious:false,hasNext:this.queue.hasNext};}}
const Nav=new Function('Base','Constants','return class extends Base {'+method+'}')(Base,Constants);
const q=new Playlist();q.setLogger(logger);
class Recommendation extends PlaylistRequestHandler {async getPreviousNextVideos(){return {previous:null,next:{id:'next'}};}}
const handler=new Recommendation();handler.setLogger(logger);q.setRequestHandler(handler);
await q.updateByMessage({name:'setPlaylist',payload:{listId:'list',videoIds:'current',videoId:'current',currentIndex:'0'}},Constants.CLIENTS.YT);
await q.setAutoplayMode(Constants.AUTOPLAY_MODES.ENABLED);
const nav=new Nav();nav.queue=q;nav.autoplayMode=q.autoplayMode;
assert.equal(q.hasNext,false);assert.equal(q.autoplay.id,'next');assert.equal(nav.getNavInfo().hasNext,true);
nav.autoplayMode=Constants.AUTOPLAY_MODES.DISABLED;assert.equal(nav.getNavInfo().hasNext,false);
// Execute the dependency's setPlaylist replacement branch: valid next must not stop;
// an empty replacement still stops. This is separate from Player.play's internal stop.
const app=fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js',import.meta.url),'utf8');
const start=app.indexOf("            if (message.name === 'setPlaylist' && (stateBeforeSet.current?.id");
const end=app.indexOf("            else if (message.name === 'updatePlaylist'",start);
let stops=0,plays=0;
const player={status:1,stop:async()=>stops++,play:async()=>plays++};
const branch=new Function('__classPrivateFieldGet','_YouTubeApp_player','PLAYER_STATUSES','return async function(stateAfterSet){const message={name:"setPlaylist"};const stateBeforeSet={current:{id:"old"}};const payload={currentTime:0};const AID=1;'+app.slice(start,end)+'}')( ()=>player,0,Constants.PLAYER_STATUSES);
await branch({current:{id:'new'}});assert.equal(stops,0);assert.equal(plays,1);
await branch({current:null});assert.equal(stops,1);
console.log('PASS: explicit TV/WEB autoplay parsing, no arbitrary recommendations; actual resolver WEB fallback; actual Playlist autoplay/Next capability; actual setPlaylist branch preserves playback and handles clear.');

