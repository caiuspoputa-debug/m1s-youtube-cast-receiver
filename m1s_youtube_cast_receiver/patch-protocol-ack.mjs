import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const marker = '// M1S BrowserChannel AID acknowledges received arrays only';
const assignment = `                this.AID = AID && this.AID ?
                    Math.max(AID, this.AID) : AID || this.AID;
`;
const increment = `                if (!AID) {
                    this.AID++;
                }
`;
const receivedUpdate = `        if (cmd.AID) {
            this.AID = Math.max(this.AID, cmd.AID);
        }`;
const patchedCase = `            case 'sendMessage':
                ${marker}
                // Outbound message AIDs can be absent or belong to another
                // session. Only updateWithMessage may advance this receive ACK.
                params = {`;

export function patchProtocolAck(input, version) {
  if (version !== '2.1.0') throw new Error(`Protocol ACK patch requires yt-cast-receiver 2.1.0; got ${version}`);
  const source = input.replace(/\r\n/g, '\n');
  const count = target => source.split(target).length - 1;
  if (count(receivedUpdate) !== 1 || count('        this.AID = 3;') !== 2) {
    throw new Error('Protocol ACK receive/reset target mismatch');
  }
  if (source.includes(marker)) {
    if (count(marker) !== 1 || count(patchedCase) !== 1 || count(assignment) || count(increment)) {
      throw new Error('Protocol ACK patched target mismatch');
    }
    return source;
  }
  const originalCase = `            case 'sendMessage':\n${assignment}                params = {`;
  // Validate every pinned target before changing either one.
  if (count(originalCase) !== 1 || count(increment) !== 1) throw new Error('Protocol ACK send target mismatch');
  return source.replace(originalCase, patchedCase).replace(increment, '');
}

export function installProtocolAck(dependencyRoot = fileURLToPath(new URL('./node_modules/yt-cast-receiver/', import.meta.url))) {
  const dependency = path.resolve(dependencyRoot);
  const packageInfo = JSON.parse(fs.readFileSync(path.join(dependency, 'package.json'), 'utf8'));
  const filename = path.join(dependency, 'dist/lib/app/BindParams.js');
  const original = fs.readFileSync(filename, 'utf8');
  const patched = patchProtocolAck(original, packageInfo.version);
  if (patched !== original) fs.writeFileSync(filename, patched);
  console.log('M1S: BrowserChannel receive ACK remains independent of outgoing state messages.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installProtocolAck(process.argv[2]);
}
