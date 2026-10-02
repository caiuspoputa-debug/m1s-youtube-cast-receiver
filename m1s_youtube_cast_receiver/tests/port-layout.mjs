import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = fs.readFileSync(new URL('../config.yaml', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');

function scalar(name) {
  const match = config.match(new RegExp(`^\\s*${name}:\\s*(\\d+)\\s*$`, 'm'));
  assert.ok(match, `Missing numeric ${name} in config.yaml`);
  return Number(match[1]);
}

const audioPort = scalar('audio_port');
const dialPort = scalar('dial_port');
const ingressPort = scalar('ingress_port');
const maxReceivers = scalar('max_receivers');
const lastDialPort = dialPort + maxReceivers - 1;

assert.match(config, /^ingress_entry:\s*settings\s*$/m, 'Ingress entry must not start with a slash');
assert.notEqual(ingressPort, audioPort, 'Ingress must not occupy the audio bridge port');
assert.ok(
  ingressPort < dialPort || ingressPort > lastDialPort,
  `Ingress ${ingressPort} overlaps DIAL range ${dialPort}-${lastDialPort}`
);
assert.match(
  source,
  new RegExp(`const FRIENDLY_NAME_SETTINGS_PORT = ${ingressPort};`),
  'Runtime Ingress port must match config.yaml'
);

console.log(`PASS: Ingress ${ingressPort} is outside audio ${audioPort} and DIAL ${dialPort}-${lastDialPort}.`);
