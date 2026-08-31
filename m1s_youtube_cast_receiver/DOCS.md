# Installation and first test - v0.2.0

This Home Assistant app/add-on is currently built for **amd64**.

## What appears in YouTube

The add-on creates one DIAL receiver for the configured group target and then discovers
individual Aqara M1S media players from Home Assistant.

Typical Cast list:

- Aqara M1S Group
- M1S Atelier
- M1S Bucataria de vara
- M1S Salon Narcisa
- M1S Curte si gradina

The exact individual names come from Home Assistant entity names.

## Discovery

`include_individual: true` enables automatic individual-player discovery.
`individual_match` is matched against both the media_player entity_id and friendly name.
The default is `aqara_m1s_zigbee_router`.

The group uses `dial_port` (default 8099). Every individual receiver uses the next port:
8100, 8101, 8102, and so on. `max_receivers` limits the total number including the group.

## Faster start

v0.2.0 does not wait for a separate yt-dlp metadata request before calling Home Assistant
`media_player.play_media`. Playback is started immediately and metadata is fetched later in
the background. This removes one serial YouTube lookup from the critical startup path.

## Audio architecture

YouTube sender -> DIAL/Lounge receiver -> local yt-dlp audio endpoint -> Home Assistant
`media_player.play_media` -> Aqara M1S integration -> existing FFmpeg/PCM transport.

The HTTP audio bridge is shared, but each receiver has its own active yt-dlp process tracking.

## TV code

To avoid generating a large number of pairing codes, the manual TV pairing code is generated
only for the group receiver. Individual players are intended to be selected directly from the
YouTube Cast menu through DIAL discovery.

## Options

- `target_entity`: group entity, default `media_player.m1s_media_group`.
- `device_name`: group name shown in YouTube.
- `audio_port`: shared local audio bridge, default 8098.
- `dial_port`: first DIAL port, default 8099.
- `stream_host`: blank = automatic LAN IPv4 detection.
- `enable_tv_code`: enables manual TV code for the group receiver.
- `include_individual`: auto-create Cast receivers for individual M1S media players.
- `individual_match`: text used to identify M1S media_player entities.
- `max_receivers`: maximum total receiver count including group.
- `log_level`: error / warn / info / debug.

## First test

Start the add-on and check the log. You should see `Discovered N Cast receiver(s)` followed by
one `Receiver:` line and one `DIAL receiver started:` line per target.

Then open YouTube on Android, press Cast and test the group first, then one individual hub.
