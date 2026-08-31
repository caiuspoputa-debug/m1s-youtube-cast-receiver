# Installation and first test

This is an experimental local Home Assistant app/add-on for **amd64** (Intel NUC).

## Install

1. Extract the folder `m1s-youtube-cast-receiver-v0.1.0` into the local apps/add-ons directory.
2. Reload the Home Assistant app/add-on store.
3. Install **M1S YouTube Cast Receiver**.
4. In Configuration, verify `target_entity`. The default is:
   `media_player.m1s_media_group`.
5. Start it and open its log.

Expected log lines include:

- `Audio bridge listening ...`
- `DIAL receiver started: "Aqara M1S Group" ...`
- optionally `TV pairing code: ...`

## Android test

Open YouTube on the phone, press the Cast icon, and look for **Aqara M1S Group**.
Select it and play a normal public video or song. YouTube Music can be tested the
same way.

If DIAL discovery does not appear in YouTube, use the TV code shown in the log:
YouTube -> Settings -> Watch on TV -> Link with TV code.

## What happens internally

YouTube sender -> DIAL/Lounge receiver -> video ID -> local yt-dlp audio endpoint
-> Home Assistant `media_player.play_media` -> Aqara M1S integration -> existing
FFmpeg/PCM M1S transport.

The Aqara v0.10.26 integration is not modified.

## Controls in v0.1.0

- Play: implemented
- Stop: implemented
- Volume/mute: implemented
- Pause/resume: implemented as stop + restart near the remembered position
- Seek: implemented as restart from the requested position (experimental)
- Next/previous: handled by yt-cast-receiver's queue, which calls the same player

## Options

- `target_entity`: M1S media player/group entity id.
- `device_name`: name shown in YouTube's receiver list.
- `audio_port`: local audio bridge HTTP port; default 8098.
- `dial_port`: DIAL HTTP port; default 8099.
- `stream_host`: normally blank for automatic LAN IPv4 detection. If playback
  reaches HA but HA cannot open the audio URL, set this to the NUC/HA LAN IP.
- `enable_tv_code`: prints a YouTube TV pairing code as a discovery fallback.
- `log_level`: error/warn/info/debug.

## Notes

The app installs the yt-dlp nightly Python package during image build and uses
Node.js as the JavaScript runtime required for current YouTube extraction.
YouTube changes frequently, so this is deliberately marked experimental.
