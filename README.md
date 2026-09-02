# M1S YouTube Cast Receiver repository

Home Assistant repository for the **M1S YouTube Cast Receiver** app/add-on.

v0.3.7 remembers whether an individual M1S receiver was in the media group before
YouTube / YouTube Music playback and restores it on Stop only when it originally was.

v0.3.6 adds automatic removal from the M1S media group when casting directly to an
individual M1S receiver.

v0.3.2 fixes short external notification interruptions so they resume the current
YouTube Music track instead of advancing the Cast queue, and removes the experimental
stage marker from the add-on manifest.

v0.3.1 fixes the Home Assistant image build from v0.3.0 by using the latest
`yt-cast-receiver` package published on npm.

v0.3.0 adds queue-aware YouTube / YouTube Music Cast playback so the receiver can advance
from the current track into the sender-provided queue, playlist, or autoplay item.

v0.2.0 added multiple YouTube Cast targets: the M1S Media Group plus automatically discovered
individual Aqara M1S media players, and reduced startup delay by moving metadata lookup out of
the playback critical path.
