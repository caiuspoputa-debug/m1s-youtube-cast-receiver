import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const marker = '// M1S 1.0.20 periodic DIAL discovery';

export function patchDiscovery(source) {
  if (source.includes(marker)) return source;
  const target = /peer\.on\("ready",function\(\)\{([\s\S]*?)self\.emit\("ready"\);\s*\}\)\.on\("search",function\(headers, address\)\{/g;
  const matches = [...source.matchAll(target)];
  if (matches.length !== 1 || !matches[0][1].includes('peer.alive(merge({')) {
    throw Error('DIAL discovery patch target mismatch; refusing to change dependency');
  }
  return source.replace(target, (_match, announce) => `${marker}
    var m1sDiscoveryTimers = [];
    var m1sAnnounce = function() {${announce}
    };
    var m1sClearDiscovery = function() {
        m1sDiscoveryTimers.forEach(function(timer) { clearTimeout(timer); clearInterval(timer); });
        m1sDiscoveryTimers = [];
    };
    // Clear before byebye is sent, so shutdown cannot advertise a stopped receiver.
    var m1sOriginalStop = self.stop;
    self.stop = function() {
        m1sClearDiscovery();
        return m1sOriginalStop.apply(self, arguments);
    };
    peer.on("close", m1sClearDiscovery);
    peer.on("ready",function(){
        m1sClearDiscovery();
        m1sAnnounce();
        [1000, 3000, 7000].forEach(function(delay) {
            m1sDiscoveryTimers.push(setTimeout(m1sAnnounce, delay));
        });
        // Stagger receivers to avoid synchronized multicast bursts.
        m1sDiscoveryTimers.push(setTimeout(function() {
            m1sAnnounce();
            m1sDiscoveryTimers.push(setInterval(m1sAnnounce, 15000));
        }, 15000 + Math.floor(Math.random() * 2000)));
        self.emit("ready");
    }).on("search",function(headers, address){`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const require = createRequire(import.meta.url);
  const receiverRequire = createRequire(require.resolve('yt-cast-receiver'));
  const dialRequire = createRequire(receiverRequire.resolve('@patrickkfkan/peer-dial'));
  const file = dialRequire.resolve('./lib/peer-dial');
  const source = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, patchDiscovery(source));
  console.log('M1S 1.0.20: periodic SSDP announcements enabled; search replies unchanged.');
}
