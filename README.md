# M1S YouTube Cast Receiver — v1.0.1

Home Assistant add-on for casting **YouTube / YouTube Music** to Aqara M1S players, individually or through **M1S Media Group**.

## Stable architecture

The add-on is the YouTube/YTM player. Home Assistant and the M1S integration are only the audio transport.

```text
Phone / YouTube Music
        ↓ Cast / DIAL
M1S YouTube Cast Receiver
        ↓ one continuous audio stream for the whole Cast session
Home Assistant / M1S integration
        ↓ PCM transport
Aqara M1S / M1S Media Group
```

A Cast session opens **one continuous HA audio stream**. When the song changes, the add-on changes the decoded track inside that same stream. Home Assistant does not receive a new per-track URL and does not restart playback for every song.

## What is kept working

- YouTube and YouTube Music Cast/DIAL receiver.
- M1S Media Group receiver.
- Automatically discovered individual Aqara M1S receivers.
- Continuous audio transport across song changes.
- Queue advance handled by the add-on.
- Phone controls such as Next, Seek, Pause and Resume handled without rebuilding the HA transport for each track.
- Stable group buffering/synchronization across a session.
- Direct cast to an individual M1S, including temporary removal from the group when required.
- Exact restoration of individual group membership after a real Stop.
- Source ownership protection when another Home Assistant source takes over the player.

## Version note

`1.0.1` uses the **same runtime implementation and settings as the working 0.3.52 continuous-session build**. The Home Assistant add-on version is changed to `1.0.1`; runtime code and options are intentionally preserved.

See [`m1s_youtube_cast_receiver/DOCS.md`](m1s_youtube_cast_receiver/DOCS.md) for installation and settings.

## DO NOT DO THIS

The following approaches caused loops, stutter, cut tracks, timing drift or group desynchronization during development and must not be reintroduced:

1. Do not STOP/PLAY Home Assistant at every song boundary.
2. Do not rebuild or prebuffer the group for every song.
3. Do not make the M1S integration decide YouTube/YTM track EOF or queue Next.
4. Do not treat one track decoder EOF as the end of the whole HA Cast session.
5. Do not add artificial end-of-track timers based on duration/current position.
6. Do not add fake duration offsets such as `+7 seconds`.
7. Do not speed up audio with `atempo` or similar timing compensation.
8. Do not use HTTP 410 / completed-track replay blocking to control normal track progression.
9. Do not move YouTube/YTM queue ownership into the M1S integration.
10. Do not modify receiver-to-hub mapping, source ownership or group restore logic to solve unrelated timing problems.
11. Do not change several timing/transport mechanisms at once while diagnosing one problem.
12. Do not return to a per-track HA transport. **One Cast session = one continuous HA transport.**
