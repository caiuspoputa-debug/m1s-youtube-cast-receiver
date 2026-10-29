import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { patchProtocolAck } from '../patch-protocol-ack.mjs';

const dependency = new URL('../node_modules/yt-cast-receiver/', import.meta.url);
const bindURL = new URL('dist/lib/app/BindParams.js', dependency);
const bindSource = fs.readFileSync(bindURL, 'utf8');
const marker = '// M1S BrowserChannel AID acknowledges received arrays only';
assert.ok(bindSource.includes(marker), 'run the protocol ACK postinstall patch before this test');
assert.equal(patchProtocolAck(bindSource, '2.1.0'), bindSource);
assert.equal(patchProtocolAck('// Another patch\n' + bindSource, '2.1.0'), '// Another patch\n' + bindSource);
assert.throws(() => patchProtocolAck(bindSource, '2.2.0'), /requires.*2\.1\.0/);
assert.throws(() => patchProtocolAck(bindSource.replace('if (cmd.AID)', 'if (cmd.changedAID)'), '2.1.0'), /receive\/reset target mismatch/);
assert.throws(() => patchProtocolAck(bindSource + '\n' + marker, '2.1.0'), /patched target mismatch/);

// Reconstruct the two pinned pre-patch statements to demonstrate the original
// failure using the actual class, rather than a simulated counter implementation.
const originalSource = bindSource.replace(/                \/\/ M1S BrowserChannel AID acknowledges received arrays only\n                \/\/ Outbound message AIDs can be absent or belong to another\n                \/\/ session\. Only updateWithMessage may advance this receive ACK\.\n/,
  '                this.AID = AID && this.AID ?\n                    Math.max(AID, this.AID) : AID || this.AID;\n')
  .replace('                this.RID++;\n                break;\n            case \'rpc\':',
    '                if (!AID) {\n                    this.AID++;\n                }\n                this.RID++;\n                break;\n            case \'rpc\':');
assert.ok(!originalSource.includes(marker));
assert.equal(patchProtocolAck(originalSource, '2.1.0'), bindSource);
assert.throws(() => patchProtocolAck(originalSource.replace('if (!AID)', 'if (AID === null)'), '2.1.0'), /send target mismatch/);

function absoluteImports(source, moduleURL) {
  const require = createRequire(moduleURL);
  return source.replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier === 'events' ? 'node:events'
    : specifier.startsWith('.') ? new URL(specifier, moduleURL).href : pathToFileURL(require.resolve(specifier)).href}'`);
}
const moduleData = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { default: OriginalBindParams } = await import(moduleData(absoluteImports(originalSource, bindURL)));
const { default: BindParams } = await import(bindURL);
const { default: Message } = await import(new URL('dist/lib/app/Message.js', dependency));
const { default: RPC } = await import(new URL('dist/lib/app/RPCConnection.js', dependency));
const { CLIENTS } = await import(new URL('dist/lib/Constants.js', dependency));

const options = { theme: 'cl', deviceId: 'fixture', screenName: 'ACK fixture', screenApp: 'fixture' };
const prepareBind = bind => {
  bind.updateWithLoungeToken({ loungeToken: 'fixture' });
  bind.updateWithMessage([new Message(0, 'c', ['fixture']), new Message(1, 'S', 'fixture')]);
};
const before = new OriginalBindParams(options); prepareBind(before);
before.updateWithMessage(new Message(18, 'noop', {}));
for (let i = 0; i < 12; i++) before.toQueryString('sendMessage');
assert.equal(new URLSearchParams(before.toQueryString('rpc')).get('AID'), '30', 'original unsolicited sends falsely acknowledged unseen arrays');

// Retain actual Session task dispatch, payload/ofs creation and received-message
// ordering. The fixture only exposes its private state and primes the same ofs=0
// used by Session.begin(), without requesting real YouTube credentials.
const sessionURL = new URL('dist/lib/app/Session.js', dependency);
let sessionSource = absoluteImports(fs.readFileSync(sessionURL, 'utf8'), sessionURL);
sessionSource += `\nexport const bindFixture = session => _Session_bindParams.get(session);
export const primeFixture = session => _Session_ofs.set(session, 0);
export const receiveFixture = (session, messages) => _Session_handleMessage.call(session, messages);`;
const { default: Session, bindFixture, primeFixture, receiveFixture } = await import(moduleData(sessionSource));
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const posts = [], rpcRequests = [], rpcControllers = [], liveRPCs = [];
const expectedAck = new Map(), expectedOfs = new Map();
const originalFetch = global.fetch;
global.fetch = async (url, request) => {
  const query = new URL(url).searchParams;
  const theme = query.get('theme');
  const ack = Number(query.get('AID'));
  // Primary reference invariant: Google Closure BrowserChannel sets both POST
  // and RPC AID from lastArrayId_, updated only by received arrays (onInput_).
  // https://github.com/google/closure-library/blob/master/closure/goog/net/browserchannel.js
  assert.equal(ack, expectedAck.get(theme), 'wire receive ACK must equal this session\'s last received array, regardless of outbound traffic');
  if (request?.method === 'POST') {
    const body = Object.fromEntries(request.body);
    assert.equal(Number(body.ofs), expectedOfs.get(theme));
    expectedOfs.set(theme, expectedOfs.get(theme) + Number(body.count));
    posts.push({ theme, ack, rid: Number(query.get('RID')), body });
    return { ok: true, status: 200 };
  }
  rpcRequests.push({ theme, ack });
  return { ok: true, status: 200, body: new ReadableStream({ start(controller) { rpcControllers.push(controller); } }) };
};
const settle = async predicate => {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'actual RPC reconnect must complete');
};

try {
  const fixtures = [];
  for (const [client, initialAck] of [[CLIENTS.YT, 18], [CLIENTS.YTMUSIC, 60]]) {
    const session = new Session({ client, logger, screenName: 'ACK fixture' });
    primeFixture(session);
    const bind = bindFixture(session); prepareBind(bind);
    receiveFixture(session, [new Message(initialAck, 'noop', {})]);
    expectedAck.set(client.theme, initialAck); expectedOfs.set(client.theme, 0);
    fixtures.push({ session, bind, client });
    const startRID = bind.RID;
    // Both clients use the same transport invariant. A full five-message state
    // batch advances ofs by five; it must never fabricate a received array ID.
    for (let i = 0; i < 60; i++) {
      const aid = i % 2 ? null : undefined;
      await session.sendMessage(Array.from({ length: 5 }, () => new Message(aid, 'onStateChange', { state: 1 })));
    }
    for (const aid of [900, 1, 0, '', null, undefined]) {
      await session.sendMessage(new Message(aid, 'onVolumeChanged', { volume: 10, muted: false }));
    }
    assert.equal(bind.AID, initialAck);
    assert.equal(bind.RID, startRID + 66, 'outgoing request IDs still advance once per dispatched request');
    assert.equal(expectedOfs.get(client.theme), 306);

    const rpc = new RPC({ bindParams: bind, logger }); liveRPCs.push(rpc);
    const controllerIndex = rpcControllers.length;
    await rpc.connect();
    // End the real RPC stream. Its normal end handler reconnects with the same
    // last received ACK; outbound heartbeats cannot advance its resume position.
    const beforeReconnect = rpcRequests.length;
    rpcControllers[controllerIndex].close();
    await settle(() => rpcRequests.length > beforeReconnect);
    assert.equal(rpcRequests.at(-1).ack, initialAck);
    rpc.close();

    let reply, appDispatched = false;
    session.once('messages', messages => {
      appDispatched = true;
      assert.equal(bind.AID, initialAck + 4, 'receive ACK advances before App dispatch');
      assert.equal(messages[1].name, 'next');
      reply = session.sendMessage(new Message(999, 'nowPlaying', { videoId: 'AAAAAAAAAAA' }));
    });
    expectedAck.set(client.theme, initialAck + 4);
    receiveFixture(session, [new Message(initialAck + 1, 'noop', {}), new Message(initialAck + 4, 'next', {}), new Message(initialAck + 2, 'noop', {})]);
    assert.equal(appDispatched, true); await reply;
    assert.equal(posts.at(-1).ack, initialAck + 4);
    receiveFixture(session, [new Message(0, 'noop', {}), new Message(null, 'noop', {}), new Message(undefined, 'noop', {})]);
    assert.equal(bind.AID, initialAck + 4, 'zero, empty and older received IDs cannot lower the last received maximum');
  }

  // Mirroring the same state object between generic YT and a YTM sidecar must
  // not transfer one session's receive counter into the other session.
  const shared = new Message(1000, 'nowPlaying', { videoId: 'AAAAAAAAAAA' });
  for (const { session } of fixtures) await session.sendMessage(shared);
  assert.deepEqual(fixtures.map(({ bind }) => bind.AID), [22, 64]);

  const bind = new BindParams(options);
  assert.equal(bind.AID, 3, 'preserve the pinned initialization counter');
  prepareBind(bind); bind.updateWithMessage(new Message(100, 'noop', {}));
  bind.reset();
  assert.equal(bind.AID, 3); assert.equal(bind.SID, undefined);
  assert.equal(bind.gsessionid, undefined); assert.equal(bind.loungeIdToken, undefined);
  assert.throws(() => bind.toQueryString('rpc'), /Missing data/);
  bind.updateWithLoungeToken({ loungeToken: 'fixture' });
  const resetRID = bind.RID;
  assert.equal(new URLSearchParams(bind.toQueryString('initSession')).get('RID'), String(resetRID));
  assert.equal(bind.RID, resetRID + 1); assert.equal(bind.AID, 3);
  prepareBind(bind); bind.updateWithMessage(new Message(4, 'loungeStatus', {}));
  assert.equal(new URLSearchParams(bind.toQueryString('rpc')).get('AID'), '4', 'fresh small IDs work after reset');
  for (const aid of [undefined, null, 0, '', 1000]) {
    assert.equal(new URLSearchParams(bind.toQueryString('sendMessage', aid)).get('AID'), '4');
    assert.equal(bind.AID, 4);
  }
} finally {
  for (const rpc of liveRPCs) rpc.close();
  global.fetch = originalFetch;
}

console.log('PASS: actual Session/RPC/BindParams keep received ACK independent of 120 heartbeat batches, foreign/zero/empty outbound IDs, sidecar mirrors and real RPC reconnects; received frames advance ACK before dispatch; RID/ofs and reset semantics remain intact.');
