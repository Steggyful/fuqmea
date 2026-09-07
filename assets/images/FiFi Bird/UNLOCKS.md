# FiFi unlock art

Drop-in assets for the Fifi Bird test build. Default still uses the three files in this folder:

- `fifi_sprite.png`
- `fifi_pipe.png`
- `fifi_bg.jpg`

Unlock variants live next to them. Game code does not swap them yet.

## Arenas (`arenas/`)

Portrait `.jpg` files match the current renderer (stretched to 360×520 and mirrored).
`*_scroll.png` files are wide looping strips for a later true-scroll pass.

| File | Notes |
|---|---|
| terminal_city | Fuqmea lime night city |
| neon_rooftop | Fuqmea alley / rooftop |
| toxic_meadow | Fuqmea lime aurora |
| spaceship_lime | Fuqmea-colored corridor |
| spaceship | Original purple-window corridor |
| starfield_poster / starfield_scroll | Space ridge |
| night_city | Dark city grade |
| sunset_city | Warm city grade |

## Skins (`skins/`)

Same 4-frame sprite sheet and pipe atlas as the originals. White cap, outlines, and slice coords are unchanged.

Brand skins: `fifi_sprite_fuqmea_lime.png`, `fifi_sprite_fuqmea_hazard.png` (+ matching pipes).

## Swap logic

`fifi-bird.js` v2.5 loads the selected skin + arena at boot and after each run.
Unlocks use lifetime best gaps. Choice is saved in `localStorage` key `fuq.fifiBird.cosmetics`.

Dev override: open games with `?fifiUnlockAll=1` to preview every chip.

## Menu

Title and game-over use on-stage PLAY / LOCKER buttons (44px targets).
Locker is a fullscreen-safe sheet with Birds and Arenas tabs.
New unlocks toast after a best-beating run. `L` toggles locker, `Esc` closes it.
