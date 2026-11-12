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
- NOT yet verified: Compose `MainActivity.kt` compile, full Gradle build, Tauri `lib.rs` compile on Windows, anything on a real Phone (3). The first GitHub Actions run is the first full build: check `gh run list` and fix what it reports.
- Real-phone checklist: docs/SETUP.md section 5.
- Not built yet: now-playing widget, Google Calendar widget, animation editor (.glyph format).
