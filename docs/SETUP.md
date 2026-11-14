# Setup and first run

Everything below is on Windows. Budget about an hour the first time, most of it downloads.

## 1. Install the tools

| Tool | Why | Check it works |
|---|---|---|
| [Node.js 22 LTS](https://nodejs.org) | PC app, CLI, tests | `node -v` prints v22 or newer |
| [Rust](https://rustup.rs) (`rustup`) | Tauri's native shell | `cargo -V` |
| [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** | Rust needs its linker | Rust's installer offers to set this up |
| WebView2 | Tauri's window | Already on Windows 10/11 |
| [Android Studio](https://developer.android.com/studio) | Builds the phone app, includes `adb` | Opens without errors |
| Git | | `git --version` |

## 2. Prepare the phone

1. Update Nothing OS. App-mode drawing on the matrix needs a system build from **August 2025 or later**.
2. Settings > About phone > tap **Build number** seven times to unlock Developer options.
3. Settings > System > Developer options > turn on **USB debugging**.
4. Plug the phone in, accept the prompt on its screen, and check `adb devices` lists it. If `adb` is not found, it lives in `%LOCALAPPDATA%\Android\Sdk\platform-tools`; add that folder to PATH.

## 3. Build and install

```powershell
git clone <your repo url> matrix-bridge
cd matrix-bridge
npm install

# Phone app
.\scripts\fetch-sdk.ps1          # downloads Nothing's SDK (not redistributable, so not in the repo)
cd android
.\gradlew installDebug           # or open the android folder in Android Studio and press Run
cd ..

# PC app
npm run dev                      # first run compiles Rust and takes several minutes
```

No phone to hand? `npm run sim` starts a fake one in the terminal; connect the PC app to `127.0.0.1` and the code it shows.

## 4. First connection

1. Open **MatrixMixer** on the phone and tap **Start**. Allow notifications if asked.
2. In the PC app, **Search this network**. If nothing is found, type the address the phone shows.
3. Enter the 6-digit code from the phone.
4. Go to **Text** and send something.

### If the PC cannot reach the phone

College and hostel Wi-Fi usually isolates devices from each other. Two ways round it:

- **USB:** run `adb forward tcp:8765 tcp:8765`, then use **Connect over USB**. Re-run the command after replugging.
- **Hotspot:** turn on the phone's hotspot, join it from the laptop, and search again.

## 5. Things to confirm on a real Phone (3)

The app was built against Nothing's SDK and documentation and tested against a simulator, not a physical phone. On the first run with real hardware, check these and note the answers in the decisions log:

- [ ] A frame from the PC lights the matrix **without** selecting any toy (app mode). If it stays dark, select the **PC Remote** toy; that path uses the older toy-mode call.
- [ ] Orientation: text reads left to right and is not mirrored or rotated.
- [ ] Brightness: full white is not painfully bright; the slider's low end is still visible.
- [ ] Scrolling text at the default speed looks smooth. Try the speed slider at both ends.
- [ ] With the screen off for 10 minutes, the PC stays connected and frames still arrive.
- [ ] The **PC Remote** toy shows up in Settings > Glyph Interface > Glyph Toys, and its two-headed arrow appears when selected.
- [ ] A long-press of the Glyph Button with PC Remote selected fires the PC action. Check whether `down` / `up` events arrive too.
- [ ] After leaving the toy (short press), the PC's frame comes back by itself, or note that it does not.
- [ ] Battery drain over 30 minutes of a running widget.

## 6. The CLI

```powershell
npm run build:cli
npm install -g ./cli
matrix send "hello"
```

While the PC app is running, commands go through it. Without it, pair the terminal directly once with `matrix pair <phone-ip>` and add `--direct`.
