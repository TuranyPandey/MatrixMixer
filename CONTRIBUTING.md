# Contributing

Thanks for wanting to help. This is a community project and is not affiliated with Nothing.

## Layout

| Folder | What | Language |
|---|---|---|
| `core/` | Protocol, frame rendering (text, images, widgets), connection client | TypeScript |
| `cli/` | The `matrix` command and the phone simulator | TypeScript |
| `desktop/` | PC app. `src/` is the window, `src-tauri/` the native shell | React + TypeScript, Rust |
| `android/` | Phone app | Kotlin |
| `docs/` | Protocol and setup | |

The phone is deliberately simple: it receives finished 25x25 frames and draws them. Anything about *what* to show belongs in `core/`, where it can be unit-tested and used by both the app and the CLI.

## Before opening a pull request

```
npm test          # unit tests + a real PC<->phone socket test against the simulator
npm run typecheck
```

If you change the protocol, update all three implementations and `docs/PROTOCOL.md` together (the table at the top of that file lists them).

## Working without a phone

`npm run sim` runs a fake Phone (3) in your terminal. `npm run dev:web` runs the PC app's window in a browser, where it can connect to the simulator. Network search, button actions and real CPU numbers need the full app (`npm run dev`).

## Nothing's SDK

`glyph-matrix-sdk-2.0.aar` is Nothing's property and its licence does not allow redistribution, so do not commit it. `scripts/fetch-sdk` downloads it from Nothing's GitHub. The licence also restricts commercial use.
