# M1S YouTube Cast Receiver

Experimental Home Assistant app/add-on that makes an Aqara M1S media player or
`M1S Media Group` controllable from the YouTube / YouTube Music sender flow.

It intentionally does **not** emulate a generic Chromecast device and does not
need a harvested Google Cast `certs.json`. It uses YouTube's DIAL/Lounge receiver
flow, then routes audio through Home Assistant to the selected M1S media player.

Default target: `media_player.m1s_media_group`.
