import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { patchDialIpv4 } from '../patch-dial-ipv4.mjs';

const receiverRoot = new URL('../node_modules/yt-cast-receiver/', import.meta.url);
const version = JSON.parse(fs.readFileSync(new URL('package.json', receiverRoot), 'utf8')).version;
const filename = fileURLToPath(new URL('dist/lib/dial/DialServer.js', receiverRoot));
const installed = fs.readFileSync(filename, 'utf8');

assert.equal(version, '2.1.0');
assert.equal((installed.match(/M1S 1\.0\.36 DIAL HTTP IPv4 bind/g) || []).length, 1);
assert.equal((installed.match(/\.port, "0\.0\.0\.0", \(\) => \{/g) || []).length, 1);
assert.equal(patchDialIpv4(installed, version), installed, 'patch must be idempotent');
assert.throws(() => patchDialIpv4('unexpected dependency', version), /target mismatch/);
assert.throws(() => patchDialIpv4(installed, '2.1.1'), /requires yt-cast-receiver 2\.1\.0/);

console.log('PASS: DIAL HTTP dependency has one verified, idempotent IPv4 listener bind.');
