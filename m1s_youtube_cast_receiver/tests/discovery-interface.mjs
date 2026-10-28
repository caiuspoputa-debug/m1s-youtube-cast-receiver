import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { selectDiscoveryNetwork } from '../discovery-network.mjs';
const require = createRequire(import.meta.url);
const index = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
const optionsText = index.match(/dial: (\{\s*port: def\.port,[\s\S]*?\n      \}),/);
assert.ok(optionsText, 'receiver DIAL options must be present');
const options = vm.runInNewContext(`(${optionsText[1]})`, {def:{port:8105},discoveryNetwork:{interface:'eno1',address:'192.168.0.20'}});
assert.equal(options.port,8105);
const receiverRequire = createRequire(require.resolve('yt-cast-receiver'));
const dialRequire = createRequire(receiverRequire.resolve('@patrickkfkan/peer-dial'));
const ssdpPath = dialRequire.resolve('@patrickkfkan/peer-ssdp');
const ssdpRequire = createRequire(ssdpPath);
const sourcePath = ssdpRequire.resolve('./lib/peer-ssdp');
const source = fs.readFileSync(sourcePath,'utf8');
const binds = [], intervals = [];
const interfaces = {
  lo:[{family:'IPv4',internal:true,address:'127.0.0.1'}],
  eno1:[{family:'IPv4',internal:false,address:'192.168.0.20',netmask:'255.255.255.0'},
        {family:'IPv4',internal:false,address:'192.168.0.21'}],
  hassio:[{family:'IPv4',internal:false,address:'172.30.32.1'}],
  docker0:[{family:'IPv4',internal:false,address:'172.30.232.1'}],
  tailscale0:[{family:'IPv4',internal:false,address:'100.123.69.127'}]
};
const routes = 'Iface Destination Gateway Flags RefCnt Use Metric Mask\n' +
  'tailscale0 00000000 00000000 0001 0 0 0 00000000\n' +
  'eno1 00000000 0100A8C0 0003 0 0 100 00000000\n';
assert.deepEqual(selectDiscoveryNetwork(interfaces,routes),{interface:'eno1',address:'192.168.0.20'});
const otherHost = {eth0:[{family:'IPv4',internal:false,address:'10.1.2.30',netmask:'255.255.255.0'}],docker0:interfaces.docker0};
assert.deepEqual(selectDiscoveryNetwork(otherHost,'Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 00000000 0102010A 0003 0 0 100 00000000'),{interface:'eth0',address:'10.1.2.30'});
otherHost.eth0[0].address='10.1.2.99';
assert.equal(selectDiscoveryNetwork(otherHost,'').address,'10.1.2.99');
assert.deepEqual(selectDiscoveryNetwork({wlan0:otherHost.eth0},''),{interface:'wlan0',address:'10.1.2.99'});
assert.throws(()=>selectDiscoveryNetwork({tailscale0:interfaces.tailscale0,docker0:interfaces.docker0},routes),/Cannot identify/);
assert.throws(()=>selectDiscoveryNetwork({eth0:otherHost.eth0,wlan0:otherHost.eth0},''),/Cannot identify/);
const fakeDgram = {createSocket(){
  const socket = new EventEmitter();
  socket.bind = (port,address) => binds.push({port,address:typeof address==='string' ? address : undefined});
  socket.close = () => {};
  return socket;
}};
const context = vm.createContext({
  require(name){
    if(name==='os') return {networkInterfaces:()=>interfaces};
    if(name==='dgram') return fakeDgram;
    return ssdpRequire(name);
  },
  module:{exports:{}}, exports:{}, Buffer, console,
  setInterval(fn){intervals.push(fn);return intervals.length;},clearInterval(){}
});
vm.runInContext(source,context);
const peer = context.exports.createPeer(options);
peer.start();
assert.equal(binds.length,2, 'only one interface must create its UDP socket pair');
assert.ok(binds.some(b=>b.address==='192.168.0.20'));
assert.ok(binds.every(b=>b.address===undefined || b.address==='192.168.0.20'));
assert.equal(intervals.length,1);
// Interface rescans must not open Docker, Tailscale or another LAN address.
intervals[0]();
assert.equal(binds.length,2);
peer.close();
console.log('PASS: real SSDP dependency restricts discovery to eno1 / 192.168.0.20, including rescans.');
