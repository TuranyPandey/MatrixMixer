# Matrix Bridge (repo: MatrixMixer)

PC companion for the Nothing Phone (3) Glyph Matrix. Read README.md, docs/SETUP.md and docs/PROTOCOL.md first.

## Layout
- `core/` TypeScript: protocol, 25x25 rendering (font, image, widgets), `MatrixClient`, `Player`
- `cli/` `matrix` CLI + phone simulator (`cli/src/sim.ts`)
- `desktop/` Tauri 2: `src/` React window, `src-tauri/` Rust (discovery, local API, actions, stats)
- `android/` Kotlin phone app (foreground service + WebSocket server + "PC Remote" Glyph Toy)

## Commands
- `npm test`, `npm run typecheck` (run both before committing)
- `npm run sim` fake phone; `npm run dev:web` window in a browser; `npm run dev` full Tauri app
- Phone: `scripts/fetch-sdk.ps1` then `cd android && .\gradlew installDebug`

## Rules
- Protocol changes touch three places plus docs: `core/src/protocol.ts`, `android/.../Protocol.kt` + `BridgeServer.kt`, `cli/src/sim.ts`, `docs/PROTOCOL.md`.
- The phone only draws finished frames. Rendering logic goes in `core/`.
- Never commit `glyph-matrix-sdk-2.0.aar` (Nothing's licence forbids redistribution).
- Only `MatrixDriver.kt` may call Nothing's SDK.

## State as of 2026-11-13
- Verified: core + CLI tests; TS client against the real Kotlin `BridgeServer` on a JVM; UI in headless Chrome against the simulator; Rust discovery/API/stats modules compiled and run on Linux.
- Also verified since: GitHub Actions is green (tests, APK, Windows installer); full Gradle build and `npm run dev` (Tauri compile) work locally on Windows.
- Real-phone checklist: docs/SETUP.md section 5. Results are below.
- Not built yet: now-playing widget, Google Calendar widget, animation editor (.glyph format).

## Where we left off (2026-11-13) — read this first
Work is on branch `hardware-verification` (not merged, not pushed). Next session starts from the list below.

Done in the last session, after the hardware run:
- PC app redesign: page titles and logo drawn in the matrix's 5x7 dot font (`desktop/src/DotText.tsx`), status wording with some voice ("No phone on the line", "Linked"), dotted sliders, flat open sections divided by hairlines.
- Connectors tab (`desktop/src/ConnectorsPanel.tsx`, `desktop/src/connectors.ts`): GitHub (pushes, merges, CI pass/fail, polled every 60 s via `gh api`, read-only allowlist in `desktop/src-tauri/src/github.rs`), PC battery low/full, recent notices list.
- Notices: `Player.notify()` in `core/src/player.ts` shows a finite source (ring blinks twice, text passes once) then resumes what was playing. `noticeSource` and `githubNews` are in `core/src/connectors.ts`, with tests. Exposed as `POST /notify` and `matrix notify "text"`.

Not yet verified for the above: a real push arriving as a notice in the Tauri app, battery notices firing, `matrix notify` from an installed CLI, and how notices look on the real phone.

User's design preferences (from feedback on the redesign):
- Keep: dot-font titles, monochrome + red accent, the voice in the wording.
- No: glassy/glowy effects or gradients, numbering on nav items, animated titles or slide-in cards, boxed/bordered content cards. Prefer flat, open sections.

Next steps, in the order agreed or suggested:
1. Clarify and fix the arrow flash on the PC Remote toy (user: "flashes too slowly", and after one long-press something "doesn't come back").
2. Confirm the GitHub connector end to end: watch `TuranyPandey/MatrixMixer`, push, see the notice on the phone.
3. Merge `hardware-verification` into `main` and push, once the user says so.
4. Next features, from community research in docs/RESEARCH.md: progress ring connector (`matrix progress 42`), now playing + music visualiser from PC audio, more connectors (stocks/crypto, calendar, Discord/Teams mentions), on-air mic light for calls.
5. Phone app has not had the redesign; offer it.
6. Plan for the Phone (4a) Pro's 13x13 matrix: everything assumes 25x25.

## Verified on hardware (2026-11-13)
Phone (3) model A024, Nothing OS build `C5.0-260924-2115` (Android 17), connected over USB (`adb forward tcp:8765 tcp:8765`) while charging. Wi-Fi was not tested: the phone was on mobile data with a VPN.

| # | docs/SETUP.md section 5 item | Result |
|---|---|---|
| 1 | Frame lights the matrix without selecting a toy (app mode) | Pass |
| 2 | Orientation: text left to right, not mirrored or rotated | Pass |
| 3 | Brightness: full white is comfortable, low end still visible | Pass |
| 4 | Scrolling text smooth at default speed and both slider ends | Pass |
| 5 | Screen off for 10 minutes, still connected | Partial: works with the screen off, but only checked briefly, on USB while charging |
| 6 | PC Remote toy listed in Glyph Toys, arrow shows when selected | Pass |
| 7 | Long-press fires the PC action | Pass (tested with Mute volume) |
| 8 | PC's frame comes back after leaving the toy | Pass, as reported by the user; not confirmed from logs |
| 9 | Battery drain over 30 minutes | Not tested (phone was charging) |

What the Glyph Button actually sends (from logcat, toy selected):
- A long-press arrives as `down`, then `long` about 500 ms later, then `up` on release.
- A hold shorter than about 500 ms is a short press: the app gets `down`, then the system moves to the next toy.
- A stray `up` arrives the moment the toy is selected (the release of the press that selected it).
- So `down` and `up` fire on every press, including the ones that leave the toy. Do not bind anything destructive to them.

Fixed during this session:
- Phone app text was black on black (title, pairing code, address). `MainActivity.kt` now wraps the screen in a `Surface`.
- `npm run dev` crashed with EBUSY because Vite watched `src-tauri/target`. `desktop/vite.config.ts` now ignores `src-tauri`.
- The arrow only showed when the PC sent nothing. It now flashes for 1.2 s on selecting the toy (`MatrixDriver.kt`).
- The Button tab's "Last:" line was overwritten by the `up` event straight after a long-press (`desktop/src/bridge.ts`).
- `PcRemoteToyService.kt` logs each button event (`adb logcat -s PcRemoteToy`).

Open issues:
- User feedback on the arrow flash: "flashes too slowly" and after one long-press something "doesn't come back". Not yet clarified or fixed.
- Play/pause was not confirmed: no media session existed on the PC when it was tried.
- Items 5 and 9 need a run on Wi-Fi and battery.

Build notes for this PC:
- Gradle 8.11.1 fails on Java 26 (the error is just "26.0.2"). Build with JDK 17: set `JAVA_HOME` to `C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot` and `ANDROID_HOME` to `%LOCALAPPDATA%\Android\Sdk` for the Gradle command.
- Reinstalling the phone app stops the bridge; tap **Start** again. The PC reconnects by itself.
