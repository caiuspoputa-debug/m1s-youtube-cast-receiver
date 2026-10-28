import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { patchDiscovery } from '../patch-discovery.mjs';

const installed = fs.readFileSync(new URL('../node_modules/@patrickkfkan/peer-dial/lib/peer-dial.js', import.meta.url), 'utf8');
assert.ok(installed.includes('// M1S 1.0.20 periodic DIAL discovery'));
assert.equal(patchDiscovery(installed), installed);
assert.throws(() => patchDiscovery('unexpected dependency'), /target mismatch/);
const start = installed.indexOf('var setupServer = function()');
const end = installed.indexOf('var getExtraHeaders', start);
assert.ok(start >= 0 && end > start);
let now = 0, serial = 0;
const timers = new Map();
const schedule = (fn, delay, repeat = false) => {
  const id = ++serial;
  timers.set(id, { fn, at: now + delay, delay, repeat });
  return id;
};
const advance = (ms) => {
  const until = now + ms;
  while (true) {
    const next = [...timers].filter(([,t]) => t.at <= until).sort((a,b) => a[1].at-b[1].at)[0];
    if (!next) break;
    const [id,t] = next;
    now = t.at;
    if (t.repeat) t.at += t.delay; else timers.delete(id);
    t.fn();
  }
  now = until;
};
const context = vm.createContext({
  setTimeout: (fn,ms) => schedule(fn,ms),
  setInterval: (fn,ms) => schedule(fn,ms,true),
  clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
  SERVER: 'test-server', cors: () => () => {},
  merge: (a,b) => Object.assign(a,b),
});
vm.runInContext(installed.slice(start,end), context);
function makeReceiver(port, uuid) {
  const peer = new EventEmitter();
  const alive = [], replies = [];
  peer.alive = headers => alive.push(headers);
  peer.reply = (headers,address) => replies.push({headers,address});
  const server = new EventEmitter();
  let stopped = false;
  Object.assign(server, {
    prefix:'/ytcr', port, uuid, ssdpPeer:peer, extraHeaders:{},
    expressApp:{use(){},get(){},post(){},delete(){}},
    stop(){ stopped = true; },
  });
  context.setupServer.call(server);
  return {server,peer,alive,replies,isStopped:()=>stopped};
}
const a = makeReceiver(8099,'group');
const b = makeReceiver(8100,'hub');
let ready = 0;
a.server.on('ready',()=>ready++);
a.peer.emit('ready'); b.peer.emit('ready');
assert.equal(a.alive.length,5);
const original = JSON.stringify(a.alive);
advance(1000);
assert.equal(JSON.stringify(a.alive.slice(5)),original);
advance(6000);
assert.equal(a.alive.length,20);
advance(25000);
assert.equal(a.alive.length,30);
assert.equal(ready,1, 'announcements must not emit extra lifecycle events');
assert.ok(b.alive.every(h=>h.LOCATION.includes(':8100/') && h.USN.includes('hub')));
const address = {address:'192.168.1.10',port:12345};
a.peer.emit('search',{ST:'urn:dial-multiscreen-org:service:dial:1'},address);
assert.equal(a.replies.length,1);
assert.equal(a.replies[0].address,address);
assert.equal(a.replies[0].headers.ST,'urn:dial-multiscreen-org:service:dial:1');
a.peer.emit('search',{ST:'unknown'},address);
assert.equal(a.replies.length,1);
a.server.stop();
assert.ok(a.isStopped());
const count = a.alive.length;
advance(60000);
assert.equal(a.alive.length,count);
assert.ok(b.alive.length > count, 'stopping one receiver must not stop the others');
b.peer.emit('close');
assert.equal(timers.size,0);
console.log('Cast discovery: repeated announcements, identity, search replies, lifecycle and independent cleanup passed.');
