import os from 'node:os';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const excluded = /^(lo$|hassio$|docker|veth|br-|tailscale|tun|tap|wg|zt|virbr|vpn|ip6tnl|sit\d)/i;
const number = value => value.split('.').reduce((n,part) => ((n << 8) | Number(part)) >>> 0, 0);
const gatewayIP = hex => hex.match(/../g).reverse().map(v => parseInt(v,16)).join('.');

export function selectDiscoveryNetwork(interfaces, routeTable) {
  const candidates = Object.entries(interfaces).flatMap(([name,entries]) =>
    excluded.test(name) ? [] : entries.filter(entry =>
      (entry.family === 'IPv4' || entry.family === 4) && !entry.internal &&
      !entry.address.startsWith('169.254.') && !entry.address.startsWith('127.')
    ).map(entry => ({interface:name, address:entry.address, netmask:entry.netmask})));
  const routes = routeTable.trim().split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/))
    .filter(row => row.length >= 8 && row[1] === '00000000' && row[7] === '00000000' &&
      (parseInt(row[3],16) & 1) && /^[0-9a-f]{8}$/i.test(row[2]))
    .sort((a,b) => Number(a[6])-Number(b[6]));
  for (const route of routes) {
    const addresses = candidates.filter(candidate => candidate.interface === route[0]);
    if (!addresses.length) continue;
    const gateway = number(gatewayIP(route[2]));
    const selected = addresses.find(candidate => candidate.netmask &&
      ((number(candidate.address) & number(candidate.netmask)) === (gateway & number(candidate.netmask))))
      || (addresses.length === 1 ? addresses[0] : null);
    if (selected) return {interface:selected.interface,address:selected.address};
  }
  // If no default route is present, a single LAN address is unambiguous.
  if (candidates.length === 1) return {interface:candidates[0].interface,address:candidates[0].address};
  throw Error('Cannot identify one LAN interface for DIAL/SSDP; check host IPv4/default route.');
}

export async function detectDiscoveryNetwork() {
  let lastError;
  for (let attempt=0; attempt<15; attempt++) {
    try {
      return selectDiscoveryNetwork(os.networkInterfaces(), fs.readFileSync('/proc/net/route','utf8'));
    } catch (error) {
      lastError = error;
      if (attempt<14) await delay(1000);
    }
  }
  throw lastError;
}
