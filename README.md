# Matrix Bridge

**Your Phone (3)'s Glyph Matrix, powered by your PC.**

Matrix Bridge turns the Glyph Matrix on the back of a Nothing Phone (3) into a tiny second screen for your computer, and the Glyph Button into an extra PC button. Open source, community-built, and not affiliated with or endorsed by Nothing.

> **Status: early.** The PC side is tested against a simulated phone. The phone app is built against Nothing's SDK but has had little time on real hardware yet. Expect rough edges and please [report them](../../issues).

## What it does

**PC to phone**
- Scrolling text
- A pixel editor with live preview
- Images and GIFs, shrunk to the 25x25 round matrix
- Live widgets: Pomodoro, countdown, clock, CPU/RAM meter

**Phone to PC**
- Long-press the Glyph Button to play/pause media, mute, lock the PC or run any command

**For developers**
- A `matrix` command line tool and a local HTTP API, so any script can push to the matrix

```
npm test && matrix send "tests passed" || matrix send "TESTS FAILED"
```

**Not in scope:** notifications, SMS and calls (use Phone Link), files and clipboard (KDE Connect), screen mirroring (scrcpy). Those tools already do it well.

## How it works

```
 PC                                              Phone (3)
 ┌──────────────────────────────┐   Wi-Fi/USB   ┌─────────────────────────┐
 │ text / image / widget        │   WebSocket   │ foreground service      │
 │   -> 25x25 frame (TypeScript)│ ────────────> │   -> Glyph Matrix SDK   │
 │ action runner (Rust)         │ <──────────── │ "PC Remote" Glyph Toy   │
 └──────────────────────────────┘ button events └─────────────────────────┘
```

The PC renders everything into finished 25x25 frames. The phone only draws them and reports button presses, which keeps the Android app small. Nothing leaves your local network: no cloud, no account.

| Folder | What | Built with |
|---|---|---|
| `core/` | Protocol, rendering, connection client | TypeScript |
| `desktop/` | PC app | Tauri 2, React, TypeScript |
| `cli/` | `matrix` command and a phone simulator | Node |
| `android/` | Phone app | Kotlin, Nothing's Glyph Matrix SDK |
| `docs/` | [Setup](docs/SETUP.md), [protocol](docs/PROTOCOL.md) | |

## Install

Grab the Windows installer and the APK from [Releases](../../releases), or build from source with [docs/SETUP.md](docs/SETUP.md).

1. Install the APK on the phone, open **Matrix Bridge** and tap **Start**.
2. Open Matrix Bridge on the PC and press **Search this network**.
3. Type the 6-digit code shown on the phone.
4. Send something from the **Text** tab.

Needs a Nothing Phone (3) on a Nothing OS build from August 2025 or later.

**College or hostel Wi-Fi?** Those networks usually stop devices seeing each other. Plug the phone in, run `adb forward tcp:8765 tcp:8765`, and use **Connect over USB**. A phone hotspot works too.

## Using the Glyph Button

Nothing OS only shares the Glyph Button with the Glyph Toy that is currently selected. Add the **PC Remote** toy in Settings > Glyph Interface > Glyph Toys, then short-press the Glyph Button until its two-headed arrow shows. From then on a long-press triggers the action you picked in the PC app's **Button** tab. A short press is never delivered to apps; it moves on to the next toy.

## Command line

```
matrix send "build passed"            scroll text
matrix image logo.png --invert        show a PNG or JPEG
matrix brightness 120
matrix clear
matrix sim                            run a fake phone in the terminal
```

While the PC app is running, commands go through it. The HTTP API behind it is documented in the app's **Developer** tab.

## Security

- The phone accepts frames only from PCs that have paired with a code read off its screen. A code works once; five wrong guesses lock pairing for 30 seconds.
- Traffic is unencrypted and meant for a network you trust. Anyone on the same network can see the frames (not much of a secret: it is 625 brightness values).
- The PC's local API listens on `127.0.0.1` only, needs a token that changes every launch, and refuses requests from web pages.
- "Run a command" actions run exactly what you typed, as you. Only you can set them, from the PC app.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). You do not need a Phone (3) to work on the PC side: `npm run sim` gives you a fake one.

## Licence and credits

MIT, see [LICENSE](LICENSE). Nothing's Glyph Matrix SDK is not part of this repository; it is downloaded at build time under [Nothing's own licence](https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit/blob/main/LICENSE.md), which restricts commercial use.

Nothing, Phone (3), Glyph and Glyph Matrix are trademarks of Nothing Technology Limited. This project is not affiliated with Nothing.
