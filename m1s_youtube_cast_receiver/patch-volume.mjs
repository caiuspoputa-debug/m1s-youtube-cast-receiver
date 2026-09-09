import fs from 'node:fs';
const file = new URL('./node_modules/yt-cast-receiver/dist/lib/app/YouTubeApp.js', import.meta.url);
const marker = '// M1S 1.0.6 phone volume step 1';
let source = fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
if (!source.includes(marker)) {
  const before = 'await __classPrivateFieldGet(this, _YouTubeApp_player, "f").setVolume(newVolume, AID);';
  const after = 'await __classPrivateFieldGet(this, _YouTubeApp_player, "f").setPhoneVolume(newVolume, AID);';
  if (source.split(before).length !== 2) throw Error('Phone volume patch target mismatch');
  fs.writeFileSync(file, marker + '\n' + source.replace(before,after));
}
console.log('M1S 1.0.6: Cast phone volume uses one-point steps.');
