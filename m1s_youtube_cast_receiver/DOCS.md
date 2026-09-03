# Installation and configuration — v1.0.1

Current build architecture: **amd64**.

## Cast targets

The add-on creates:

- one receiver for the configured group target, by default `media_player.m1s_media_group`;
- individual receivers discovered from Home Assistant when `include_individual: true`.

Individual discovery uses `individual_match` against the media player entity id and friendly name. Default: `aqara_m1s_zigbee_router`.

## Ports

- `audio_port`: continuous local audio bridge, default `8098`.
- `dial_port`: first DIAL receiver port, default `8099`.
- additional individual receivers use following DIAL ports.

## Audio behavior

YouTube/YTM opens one continuous Home Assistant transport for the active Cast session. Song boundaries are handled inside the add-on. Home Assistant does not need a new audio URL for every song.

## Individual M1S already in the group

With `auto_remove_individual_from_group: true`, an M1S selected directly can be removed temporarily from the M1S group before playback. With `auto_restore_individual_to_group: true`, it is restored after a real Stop only when it was originally a group member.

## Options

- `target_entity`: group media player entity.
- `device_name`: group receiver name shown to YouTube/YTM.
- `audio_port`: continuous audio HTTP port.
- `dial_port`: first DIAL port.
- `stream_host`: blank uses automatic LAN IPv4 detection.
- `enable_tv_code`: enable manual TV pairing code for the group receiver.
- `include_individual`: discover individual M1S media players.
- `individual_match`: discovery text for individual players.
- `max_receivers`: maximum number of receivers including the group.
- `resume_interrupted_stream`: preserved 0.3.52 option.
- `resume_interrupted_delay_ms`: preserved 0.3.52 option.
- `auto_remove_individual_from_group`: temporarily remove a directly cast individual from the group when necessary.
- `auto_restore_individual_to_group`: restore original group membership on real Stop.
- `auto_remove_group_delay_ms`: wait after group removal before direct playback.
- `log_level`: `error`, `warn`, `info`, or `debug`.

## First test

1. Start the add-on.
2. Confirm the group and expected individual receivers are discovered in the add-on log.
3. Open YouTube or YouTube Music on the phone.
4. Cast first to the group, then to one individual receiver.
5. Play several consecutive songs and verify that song changes occur without a new HA buffering cycle.

## Architecture rule

Do not add per-track STOP/PLAY, per-track group prebuffer, integration-side YTM EOF detection, artificial duration offsets, audio acceleration, or HTTP 410 replay blocking. The Cast session must remain one continuous HA audio transport.
