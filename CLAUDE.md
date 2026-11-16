# MatrixMixer

The product is called MatrixMixer (renamed from "Matrix Bridge" on 2026-11-14). Internal identifiers keep the old name on purpose, because changing them would drop settings and pairing: the `@matrix-bridge/*` packages, `matrix-bridge.exe`, `~/.matrix-bridge`, the Tauri identifier `io.github.matrixbridge.desktop`, the Android package `io.github.matrixbridge.phone`, and the `matrix-bridge.*` storage keys.

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
Everything up to 2026-11-13 evening is merged into `main` and pushed. Next session starts from the list below.

Done in the last session, after the hardware run:
- PC app redesign: page titles and logo drawn in the matrix's 5x7 dot font (`desktop/src/DotText.tsx`), status wording with some voice ("No phone on the line", "Linked"), dotted sliders, flat open sections divided by hairlines.
- Connectors tab (`desktop/src/ConnectorsPanel.tsx`, `desktop/src/connectors.ts`): GitHub (pushes, merges, CI pass/fail, polled every 60 s via `gh api`, read-only allowlist in `desktop/src-tauri/src/github.rs`), PC battery low/full, recent notices list.
- Notices: `Player.notify()` in `core/src/player.ts` shows a finite source (ring blinks twice, text passes once) then resumes what was playing. `noticeSource` and `githubNews` are in `core/src/connectors.ts`, with tests. Exposed as `POST /notify` and `matrix notify "text"`.

- Island: a second, always-on-top Tauri window (`desktop/island.html`, `desktop/src/Island.tsx`) showing a pill at the top centre of the screen that mirrors the matrix; hovering opens quick controls. The main window owns the connection and feeds it over Tauri events (`islandHost.ts`, `islandLink.ts`); sizes, placement and the pointer watcher are in `lib.rs`. Toggle: "Island on the desktop" in the side column, or the tray menu. Placement: six spots (top/bottom x left/centre/right, `islandPlace` setting, picker under the toggle), kept clear of the taskbar; the panel holds only brightness, a text box (Enter sends), Clear, Open app and Hide. Verified on this PC: shows, expands on hover, folds back, mirrors text sent through the API. Not verified: the placement picker on screen, clicking the panel's controls, the tray toggle, the installed (non-dev) build.

- Added 2026-11-14: widget buttons toggle (clicking "Showing" takes the widget off); text is sent with `hold: true` (`textSource` in `core/src/player.ts`), so after its passes it rests on the matrix instead of going dark, and Repeat defaults to Once; the island panel has Text and Widgets tabs. The Widgets tab shows live readings (clock, timer, CPU/RAM, load graph, ticker, weather, visualiser); clicking a row puts that widget on the matrix or takes it off, and the Timer row starts a 25/5 Pomodoro, pauses and stops. Readings are only gathered while that tab is open (`watch` message, `IslandLive` in `islandLink.ts`); the window is taller on that tab (`ISLAND_TALL` in `lib.rs`). Verified in headless Edge (main window + island linked over BroadcastChannel, no phone). Not verified: in the Tauri window (native resize between tabs, real ticker and weather readings), on the phone.

- Installed app, 2026-11-14: `tauri-plugin-single-instance` (a second launch raises the running copy's window) and `tauri-plugin-autostart` ("Start with Windows" checkbox in the side column; commands `autostart_get`/`autostart_set` in `lib.rs`; the Run entry passes `--hidden`, which leaves the main window hidden in the tray). The main window is created hidden and shown in `setup`. Release: push a `v*` tag and CI attaches the installer and APK. Verified with a locally built installer (`npm run build:desktop`, silent install to `%LOCALAPPDATA%\MatrixMixer`): desktop and Start Menu shortcuts are created, the app starts and its API answers, a second launch stays at one process and shows the window, `--hidden` starts with only the island. Not verified: ticking "Start with Windows" and signing in again.

- Features from docs/RESEARCH.md, built 2026-11-13 (see that file's "Built" list for what was skipped and why):
  - Frames in `core/src/faces.ts`, .ics parsing in `core/src/calendar.ts`, tests in `core/test/features.test.ts`.
  - `desktop/src/activities.ts`: progress ring (`POST /progress`, `matrix progress 42 BUILD`), on-air light, now-playing notices, calendar notices, CS2 game HUD (`POST /game`, token in the body). All go through `player.notify`, so the previous source comes back.
  - `desktop/src/widgets.ts`: load graph, visualiser (12-band spectrum: WASAPI loopback capture and FFT in `media.rs`, smoothing and peak caps in `spectrumSmoother`), ticker (Yahoo Finance chart endpoint, unofficial), weather (Open-Meteo).
  - Rust: `media.rs` (media session + loopback spectrum via the `windows` crate), `onair.rs` (`reg query` on the ConsentStore), `fetch.rs` (https via `curl`).
  - Verified on this PC: unit tests; `cargo test media -- --ignored --nocapture` (read the current track, levels, mic state, an https fetch); progress ring end to end through the running app's API; both tabs render in headless Edge.
  - Not verified: on-air with a real call, a track-change notice, the visualiser/ticker/weather/graph buttons inside the Tauri window, the calendar with a real .ics link, the game HUD against the real game, how any of these look on the phone.
- Built 2026-11-16 and released as v0.2.1 the same day:
  - PC app: island button on the stage; Connectors and Glyph Button moved to the front row next to Text/Draw/Image/Widgets, Settings keeps Phone, Desktop and an opt-in Developer page (`developer` setting). Connectors is a shelf of matrix previews like Widgets (`PREVIEWS` in `ConnectorsPanel.tsx`); Glyph Button leads with the long-press as a grid of actions.
  - Ambient widget (`core/src/ambient.ts`: rain, starfield, Game of Life), ready-made pictures on the Image page (`core/src/designs.ts`), animation frames on the Draw page (up to 24, 50-1000 ms each).
  - Draw and Image are now one Images mode (`ImagesPanel.tsx`) with three views: Saved, Draw, From a file. One library (`library.ts`, same `matrix-bridge.drawings` storage key) holds everything saved by name plus the ready-made pictures; the island has an Images tab with a sideways-scrolling row of them.
  - Mic mute: `mic.rs` flips the Windows microphone switch; the on-air light reads MUTED. Calendar countdown disk (`countdownFrame`), Reminder connector.
  - Protocol additions: `store`/`stored` (the phone keeps one glyph) and `battery`. Draw has "Keep on phone"; the status pill shows the phone's battery.
  - Phone app: redesigned to match the PC app (dot-font logo, live matrix preview, flat sections). New: "My Glyph" toy (`MyGlyphToyService` in `Extras.kt`) that loops the stored glyph with no PC; start with the phone and after an app update (`StartReceiver`); Quick Settings tile; dark when lying on its back (accelerometer in `BridgeService`); what to do when the PC goes away (dark / last picture / My Glyph), all in `Prefs.kt`.
  - Verified on the real phone over wireless adb (`adb connect`, then `adb forward tcp:8765 tcp:8765`): the new app installs over the old debug build and starts; a test client paired, got `battery`, and `store` was answered with `stored`; the installed PC app linked and accepted a notice. Verified on this PC: `cargo test mic -- --ignored` flips and restores the real mic.
  - Not verified (the phone was locked, so nothing was seen on its screen or matrix after starting): the My Glyph toy, the resting face, dark-on-its-back, the tile, start on boot, and how anything new looks on the matrix. On the PC: clicking through the new pages in the Tauri window.
  - Not built: QR pairing (the phone is the server, so the PC would need a new LAN listener; little gain where discovery already fails) and Phone (4a) Pro 13x13 support (needs its own design and a device to test on).
- Release signing: the phone app is signed with one permanent key so updates install over each other. It is not in the repo: CI reads it from the `ANDROID_KEYSTORE_*` GitHub secrets, and this PC reads it from `~/.matrixmixer-keys/keystore.properties` (see `android/app/build.gradle.kts`). Losing that folder means every phone user has to uninstall once more. v0.2.0 and earlier were signed with throwaway keys.
- Releasing: bump the version in the four `package.json` files, `Cargo.toml`, `tauri.conf.json` and `android/app/build.gradle.kts` (`versionName`, and `versionCode` up by one), commit, then push a `v*` tag. Check the commit succeeded before tagging: git has no global identity on this PC.
- README screenshots (`docs/images/`) were taken in headless Edge against the simulator, so the status pill reads "Simulated Phone (3)"; `phone.png` is a real screenshot.
- Gotcha: wireless adb's port changes each time wireless debugging is toggled; `adb mdns services` shows the current one.
- Gotcha: after files are rewritten by a script, Vite's dev server sometimes keeps serving a stale or empty module (window stays blank, `GET /status` says "starting"). `touch` the files in `desktop/src` to fix.

Not yet verified for the above: a real push arriving as a notice in the Tauri app, battery notices firing, `matrix notify` from an installed CLI, and how notices look on the real phone.

User's design preferences (from feedback on the redesign):
- Keep: dot-font titles, monochrome + red accent, the voice in the wording.
- No: glassy/glowy effects or gradients, numbering on nav items, animated titles or slide-in cards, boxed/bordered content cards. Prefer flat, open sections.

Next steps, in the order agreed or suggested:
1. Clarify and fix the arrow flash on the PC Remote toy (user: "flashes too slowly", and after one long-press something "doesn't come back").
2. Confirm the GitHub connector end to end: watch `TuranyPandey/MatrixMixer`, push, see the notice on the phone.
4. Next features: see "Suggested next features" in docs/RESEARCH.md (progress ring, on-air light, now playing + visualiser first).
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
