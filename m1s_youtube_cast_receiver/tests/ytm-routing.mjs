import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js', import.meta.url), 'utf8');

assert.ok(source.includes('// M1S 1.0.8 YTM active-session routing'));
assert.ok(source.includes("? __classPrivateFieldGet(this, _YouTubeApp_sessions, \"f\").YTMUSIC\n                        : session;"));
assert.ok(source.includes("if (sender?.client?.key === 'YTMUSIC') {"));
assert.ok(source.includes("else {\n        await __classPrivateFieldGet(this, _YouTubeApp_instances, \"m\", _YouTubeApp_checkAndSwitchActiveSession).call(this, session);\n    }"));
assert.ok(source.includes("client?.key === 'YTMUSIC' && __classPrivateFieldGet(this, _YouTubeApp_connectedSenders, \"f\").length > 0"));

// Guardrail: the ordinary YouTube sender path must still use the library's
// original checkAndSwitchActiveSession(session) behavior.
const connectStart = source.indexOf('_YouTubeApp_handleSenderConnected = async function');
const connectEnd = source.indexOf('_YouTubeApp_handleSenderDisconnected = async function');
const connectBody = source.slice(connectStart, connectEnd);
assert.ok(connectBody.includes("sender?.client?.key === 'YTMUSIC'"));
assert.ok(connectBody.includes('_YouTubeApp_checkAndSwitchActiveSession).call(this, session)'));

console.log('PASS: YTM is routed to the YTM control session; ordinary YouTube sender routing is preserved.');
