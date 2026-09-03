# M1S YouTube Cast Receiver — v1.0.2

This add-on exposes the Aqara M1S Media Group and discovered individual Aqara M1S media players as YouTube / YouTube Music Cast/DIAL targets.

## Architecture

The add-on owns YouTube/YTM playback: Cast state, track extraction, queue progression and track changes. Home Assistant receives one continuous audio stream for the Cast session and the M1S integration transports that audio to the hub(s).

**Track change does not mean a new HA playback session.** The next decoded track is fed into the same continuous stream.

This keeps group buffering and synchronization stable in the same way a continuous radio stream does.

## Preserved behavior

- Group and individual Cast targets.
- Continuous session audio.
- Queue progression inside the add-on.
- Phone Next / Seek / Pause / Resume without per-track HA transport restart.
- Automatic temporary removal of an individual M1S from the group when direct playback requires it.
- Restoration to the group only when that M1S was originally in the group.
- Same-phone Individual → Group handoff restores that individual before Group playback; Individual → Individual and other-phone sessions are not altered.
- Protection against stale YouTube commands taking control back from another HA source.

## Important

v1.0.2 preserves the continuous-stream runtime and configuration from v1.0.1. Its only runtime change is same-sender Individual → Group restore, keyed by `Sender.id`; implicit disconnect behavior and multi-phone independence remain unchanged.

See `DOCS.md` for installation/options and the repository root `README.md` for the rules that must not be reintroduced.
