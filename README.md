# Radio Favorites

Home Assistant custom integration that keeps one editable radio-station list
and routes the selected station to any existing `media_player` entity.

Version: **0.1.0 (test release)**

## What it creates

- `media_player.radio_favorites`: central radio proxy with the configured
  station list in its Source selector.
- `select.radio_favorites_target_media_player`: chooses the real player that
  receives playback, volume, mute, stop and turn-off commands.

The target can be an Aqara hub, Google Cast, television or another integration
that accepts the standard Home Assistant `media_player.play_media` action.

## Installation

Copy `custom_components/radio_favorites` to Home Assistant's
`/config/custom_components/`, restart Home Assistant, then add **Radio
Favorites** from **Settings > Devices & services**.

## Add or delete stations

Open **Settings > Devices & services > Radio Favorites > Configure**.

1. Choose **Add or update a radio station**.
2. Enter its name and direct HTTP/HTTPS audio stream URL.
3. Repeat for every station. The window remains open after each operation.
4. Choose **Finish and close** to save the list.

The initial list contains Radio Café România as a working example. It can be
updated or deleted.

## Playback

1. Select the real output under **Target Media Player**. Options show both the
   friendly Home Assistant name and the exact entity ID.
2. Open **Radio Favorites**.
3. Choose a station from **Source**. Selecting it starts playback immediately.
4. Play, stop, mute and volume commands are forwarded to the selected target.

The integration never modifies the target integration or its entities.
