# Installation and first test - v0.3.6

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

## Individual players that are in the group

If you cast directly to an individual Aqara M1S while that player is still included in
`media_player.m1s_media_group`, the Aqara integration may not play anything on the individual
target until it is removed from the group.

With `auto_remove_individual_from_group: true`, the add-on uses the matching switch discovered at startup, ending
in `_include_in_m1s_media_group`. When that switch is on, it turns the switch off, waits
`auto_remove_group_delay_ms` milliseconds, and then starts the YouTube / YouTube Music stream.

The default wait is 300 ms.

## Short notification interruptions

If another Home Assistant action or notification sound briefly takes over the same Aqara M1S
media player, the add-on treats that as an interruption, not as the natural end of the track.
It resumes the same YouTube Music item instead of asking the Cast queue for the next item.

The default resume delay is 300 ms. Use `resume_interrupted_delay_ms: 0` for immediate resume.

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
- `resume_interrupted_stream`: resume the current track when the audio stream is interrupted.
- `resume_interrupted_delay_ms`: delay before resume after a short interruption, default 300.
- `auto_remove_individual_from_group`: remove an individual player from the M1S media group
  before direct playback, default true.
- `auto_remove_group_delay_ms`: delay after removing the player from the group, default 300.
- `log_level`: error / warn / info / debug.

## First test

Start the add-on and check the log. You should see `Discovered N Cast receiver(s)` followed by
one `Receiver:` line and one `DIAL receiver started:` line per target.

Then open YouTube on Android, press Cast and test the group first, then one individual hub.


### Restore individual hub to group after YouTube Stop

With `auto_restore_individual_to_group: true` (default), an individual hub that was in the M1S media group before YouTube / YouTube Music playback is automatically returned to that group when the YouTube session is stopped. If it was already outside the group, it remains outside. The pre-playback membership is remembered once per session so track changes, seeks and interruption resumes do not lose it.

### Stop when the sender app is closed

With `stop_on_implicit_sender_disconnect: true` (default), if the last YouTube / YouTube Music sender disconnects implicitly, playback is stopped after `sender_disconnect_stop_delay_ms` (default 1000 ms). A sender that reconnects during the grace period cancels that Stop. This also uses the normal Stop path, including conditional restore of an individual hub to the M1S media group.
