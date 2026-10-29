import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sessionMarker = '// M1S discovery identity reads the persisted Lounge device ID';
const sessionGetter = `    ${sessionMarker}
    get discoveryDeviceId() {
        return __classPrivateFieldGet(this, _Session_bindParams, "f").id;
    }
    get discoveryIdentitySessionId() {
        return __classPrivateFieldGet(this, _Session_bindParams, "f").SID;
    }
    get discoveryIdentityReady() {
        const state = __classPrivateFieldGet(this, _Session_status, "f");
        return Boolean(__classPrivateFieldGet(this, _Session_bindParams, "f").SID)
            && state !== STATUSES.STOPPED && state !== STATUSES.STOPPING;
    }
`;
const appMarker = '// M1S discovery identity handshake with bounded per-session replies';
const appHelper = `${appMarker}
const m1sDiscoveryIdentityJobs = new WeakMap();
function m1sDiscoveryIdentityLog(logger, session, event, detail, label) {
    try {
        const client = session.client?.key === 'YTMUSIC' ? 'YTMUSIC' : 'YT';
        const receiver = String(label || 'receiver').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').slice(0, 80);
        logger.info('[M1S-CAST] [' + receiver + '] event=discovery_identity_' + event + ' clientKey=' + client + (detail ? ' ' + detail : ''));
    } catch (_) { /* Identity diagnostics cannot affect playback. */ }
}
function m1sCancelDiscoveryIdentity(app, session, expectedJob) {
    const jobs = m1sDiscoveryIdentityJobs.get(app);
    const job = jobs?.get(session);
    if (!job || (expectedJob && job !== expectedJob)) return false;
    job.cancelled = true;
    clearInterval(job.timer);
    if (jobs.get(session) === job) jobs.delete(session);
    return true;
}
function m1sClearDiscoveryIdentity(app) {
    const jobs = m1sDiscoveryIdentityJobs.get(app);
    if (!jobs) return;
    for (const session of jobs.keys()) m1sCancelDiscoveryIdentity(app, session);
    m1sDiscoveryIdentityJobs.delete(app);
}
function m1sStartDiscoveryIdentity(app, session, logger, AID, label) {
    try {
        const stopped = () => app.state === STATUSES.STOPPING || app.state === STATUSES.STOPPED
            || session.discoveryIdentityReady === false;
        if (stopped()) return;
        let jobs = m1sDiscoveryIdentityJobs.get(app);
        if (!jobs) { jobs = new Map(); m1sDiscoveryIdentityJobs.set(app, jobs); }
        const previous = jobs.get(session);
        if (previous && previous.sessionId !== session.discoveryIdentitySessionId) m1sCancelDiscoveryIdentity(app, session, previous);
        m1sDiscoveryIdentityLog(logger, session, 'request', 'pending=' + jobs.has(session), label);
        if (jobs.has(session)) return;
        const id = session.discoveryDeviceId;
        if (typeof id !== 'string' || !id.trim()) {
            m1sDiscoveryIdentityLog(logger, session, 'unavailable', '', label);
            return;
        }
        const job = { timer: null, retryCount: 0, attempts: 0, cancelled: false,
            sessionId: session.discoveryIdentitySessionId };
        jobs.set(session, job);
        const current = () => !job.cancelled && !stopped()
            && m1sDiscoveryIdentityJobs.get(app) === jobs && jobs.get(session) === job
            && session.discoveryIdentitySessionId === job.sessionId && session.discoveryDeviceId === id;
        const send = () => {
            if (!current()) return;
            job.attempts++;
            m1sDiscoveryIdentityLog(logger, session, 'response', 'attempt=' + job.attempts, label);
            try {
                Promise.resolve(session.sendMessage(new Message(AID, 'setDiscoveryDeviceId', {
                    discoveryDeviceId: id, loungeDeviceId: id
                }))).catch(() => m1sDiscoveryIdentityLog(logger, session, 'send_failed', '', label));
            } catch (_) { m1sDiscoveryIdentityLog(logger, session, 'send_failed', '', label); }
        };
        // Match the TV client: initial reply plus four 10-second retries. The
        // fifth interval clears the job without sending a sixth response.
        job.timer = setInterval(() => {
            if (!current()) { m1sCancelDiscoveryIdentity(app, session, job); return; }
            job.retryCount++;
            if (job.retryCount >= 5) { m1sCancelDiscoveryIdentity(app, session, job); return; }
            send();
        }, 10000);
        job.timer.unref?.();
        send();
    } catch (_) { m1sDiscoveryIdentityLog(logger, session, 'unavailable', '', label); }
}
`;
const requestCase = `        case 'getDiscoveryDeviceId': {
            m1sStartDiscoveryIdentity(this, session, __classPrivateFieldGet(this, _YouTubeApp_logger, "f"), AID,
                __classPrivateFieldGet(this, _YouTubeApp_player, "f").definition?.name);
            break;
        }
        case 'onSetDiscoveryDeviceId': {
            const pending = m1sCancelDiscoveryIdentity(this, session);
            m1sDiscoveryIdentityLog(__classPrivateFieldGet(this, _YouTubeApp_logger, "f"), session, 'ack', 'pending=' + pending,
                __classPrivateFieldGet(this, _YouTubeApp_player, "f").definition?.name);
            break;
        }
`;
const stopCleanup = '        m1sClearDiscoveryIdentity(this);\n';

function requireVersion(version) {
  if (version !== '2.1.0') throw new Error(`Discovery identity patch requires yt-cast-receiver 2.1.0; got ${version}`);
}
function once(source, before, after, target) {
  if (source.split(before).length !== 2) throw new Error(`Discovery identity ${target} target mismatch; refusing partial patch`);
  return source.replace(before, after);
}
export function patchDiscoverySession(input, version) {
  requireVersion(version);
  const source = input.replace(/\r\n/g, '\n');
  if (source.includes(sessionMarker)) {
    if (source.split(sessionMarker).length !== 2 || source.split(sessionGetter).length !== 2) {
      throw new Error('Discovery identity Session patched target mismatch');
    }
    return source;
  }
  return once(source, '    get client() {', sessionGetter + '    get client() {', 'Session getter');
}
export function patchDiscoveryApp(input, version) {
  requireVersion(version);
  const source = input.replace(/\r\n/g, '\n');
  if (source.includes(appMarker)) {
    for (const target of [appHelper, requestCase, stopCleanup]) {
      if (source.split(target).length !== 2) throw new Error('Discovery identity App patched target mismatch');
    }
    if (source.split(appMarker).length !== 2) throw new Error('Discovery identity App marker mismatch');
    return source;
  }
  let patched = once(source, "        case 'getNowPlaying': {", requestCase + "        case 'getNowPlaying': {", 'App dispatch');
  patched = once(patched, '    async stop(error) {\n', '    async stop(error) {\n' + stopCleanup, 'App stop');
  return appHelper + patched;
}
export function installDiscoveryIdentity(dependencyRoot = fileURLToPath(new URL('./node_modules/yt-cast-receiver/', import.meta.url))) {
  const root = path.resolve(dependencyRoot);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const targets = [
    ['dist/lib/app/Session.js', patchDiscoverySession],
    ['dist/lib/app/YouTubeApp.js', patchDiscoveryApp]
  ].map(([relative, transform]) => {
    const filename = path.join(root, relative);
    const original = fs.readFileSync(filename, 'utf8');
    return { filename, original, patched: transform(original, version) };
  });
  let changed = false;
  // Validate both files before writing either one, including an existing .33
  // installation whose other pinned protocol patches are already present.
  for (const target of targets) if (target.patched !== target.original) {
    fs.writeFileSync(target.filename, target.patched);
    changed = true;
  }
  return changed;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changed = installDiscoveryIdentity(process.argv[2]);
  console.log(changed ? 'M1S: persisted discovery identity handshake enabled.' : 'M1S: discovery identity patch already applied.');
}
