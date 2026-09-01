# M1S YouTube Cast Receiver repository

Home Assistant repository for the **M1S YouTube Cast Receiver** app/add-on.

v0.3.0 adds queue-aware YouTube / YouTube Music Cast playback so the receiver can advance
from the current track into the sender-provided queue, playlist, or autoplay item.

v0.2.0 added multiple YouTube Cast targets: the M1S Media Group plus automatically discovered
individual Aqara M1S media players, and reduced startup delay by moving metadata lookup out of
the playback critical path.
