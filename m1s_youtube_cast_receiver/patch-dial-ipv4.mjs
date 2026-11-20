import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const marker = '// M1S 1.0.36 DIAL HTTP IPv4 bind';
const originalListen = '__classPrivateFieldGet(this, _DialServer_expressServer, "f").listen(__classPrivateFieldGet(this, _DialServer_dialOptions, "f").port, () => {';
const ipv4Listen = '__classPrivateFieldGet(this, _DialServer_expressServer, "f").listen(__classPrivateFieldGet(this, _DialServer_dialOptions, "f").port, "0.0.0.0", () => {';

function requireVersion(version) {
  if (version !== '2.1.0') {
    throw new Error(`DIAL IPv4 patch requires yt-cast-receiver 2.1.0; got ${version}`);
  }
}

export function patchDialIpv4(input, version) {
  requireVersion(version);
  const source = input.replace(/\r\n/g, '\n');
  if (source.includes(marker)) {
    if (source.split(marker).length !== 2 || source.split(ipv4Listen).length !== 2) {
      throw new Error('DIAL IPv4 existing patch does not match the verified form');
    }
    return source;
  }
  if (source.split(originalListen).length !== 2) {
    throw new Error('DIAL IPv4 listen target mismatch; refusing to change dependency');
  }
  return source.replace(originalListen, `${marker}\n                ${ipv4Listen}`);
}

export function installDialIpv4(
  dependencyRoot = fileURLToPath(new URL('./node_modules/yt-cast-receiver/', import.meta.url))
) {
  const root = path.resolve(dependencyRoot);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const filename = path.join(root, 'dist/lib/dial/DialServer.js');
  const original = fs.readFileSync(filename, 'utf8');
  const patched = patchDialIpv4(original, version);
  if (patched === original) return false;
  fs.writeFileSync(filename, patched);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changed = installDialIpv4(process.argv[2]);
  console.log(changed
    ? 'M1S 1.0.36: DIAL HTTP servers now listen explicitly on IPv4.'
    : 'M1S 1.0.36: DIAL HTTP IPv4 patch already applied.');
}
