# M1S YouTube Cast Receiver

Home Assistant app repository for an experimental YouTube / YouTube Music receiver
that forwards audio to Aqara M1S media players through Home Assistant.

## Add this repository to Home Assistant

Add this GitHub repository to the Home Assistant Apps store:

`https://github.com/caiuspoputa-debug/m1s-youtube-cast-receiver`

Then install **M1S YouTube Cast Receiver** from the repository.

The default playback target is:

`media_player.m1s_media_group`

## Architecture

YouTube / YouTube Music sender -> DIAL / YouTube Lounge -> local yt-dlp audio endpoint
-> Home Assistant `media_player.play_media` -> Aqara M1S integration -> existing
FFmpeg / PCM transport -> M1S hub or M1S Media Group.

The existing Aqara integration is not modified by this app.

## Status

Experimental, version 0.1.0. See the app's `DOCS.md` for installation and first-test instructions.
