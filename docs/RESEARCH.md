# What the Nothing community wants (researched 2026-11-13)

Web research into what Phone (3) owners ask for from the Glyph Matrix, and how it lines up with MatrixMixer. Most sources are from mid to late 2025; none is a survey, so these are recurring requests, not ranked demand.

## Headline findings
- The most repeated criticism is that the Glyph Matrix is a gimmick with nothing practical to show (Android Authority, Gizmodo, several reviews). Nothing publicly disputes this. MatrixMixer's pitch: the matrix becomes a useful status light for your desk.
- No existing project was found that drives the matrix live from a PC. Everything else runs on the phone.
- Nothing's SDK now also lists the Phone (4a) Pro, with a 13x13 matrix. MatrixMixer assumes 25x25 everywhere.

## Requests and fit

| Community want | Evidence | Fit with MatrixMixer |
|---|---|---|
| Something practical, not a gimmick | Android Authority: "yet to make it truly practical", left to the community | High: connectors and notices are the answer |
| Music visualiser | Nothing Community thread; Glyph Beat and SmartGlyph toys | Medium-high: PC knows what's playing and has the audio |
| Live progress (timers, deliveries, rides) | Nothing OS 4.0 rebuilt Glyph Progress on Android 16 Live Updates | High: PC progress (downloads, builds, renders) as a filling ring |
| Remappable Glyph Button | Beebom OS 4.0 wishlist; complaints about accidental presses | Already built (Button tab) |
| Notifications on the matrix | SmartGlyph, Glyph Matrix Notifications | Medium: PC-side alerts (Discord, Teams, email) |
| Data tickers | Glyph Stock Ticker toy, CgmGlyph (glucose) | High and cheap: more connectors |
| Drawings and animations | GlyphWorks, nothing-dot, Glyph Matrix Canvas, Matrices | Pixel editor exists; `.glyph` editor overlaps with these, lower priority |
| Games | Glyph Bike, snake, Arkanoid | Low: phone-side toys do this well |

## Suggested next features
Updated 2026-11-13 after a second search (desk status lights, Stream Deck, LED matrix use cases).

Build first (small, reuse connectors and notices):
1. Progress ring: `matrix progress 42`, `POST /progress`, hooks for downloads, builds, renders and test runs.
2. On-air light: detect mic or camera in use (Windows privacy registry keys) and show a red ON AIR ring. Busylights (Luxafor, Kuando) sell hardware for exactly this.
3. Now playing plus a visualiser: Windows media session for the title, WASAPI loopback for the levels. Glyph Beat does this on the phone; nobody does it from a PC.

Next:
4. PC stats faces: CPU/GPU temperature and load as bars (stats already collected in Rust). Framework LED matrix owners ask for this.
5. Stream Deck plugin: buttons that send notices or switch scenes, as busylight makers ship.
6. More connectors: stocks/crypto ticker, calendar, Discord/Teams mentions.
7. AI usage ring: tokens or credits as a ring, fed from the PC (a community toy already shows Claude usage limits).
8. Game HUD: health or ammo as a bar from games with state APIs (CS2 Game State Integration).

Lower priority:
9. Weather and clock face (Aeroglyph does this on the phone).
10. Face-down reminders (needs phone sensors, so it belongs in the phone app).
11. Once stable, post in the Nothing Community toy index thread.

## Built (2026-11-13)
- Built: progress ring, on-air light, now-playing notices, visualiser, load graph, ticker (stocks and crypto), calendar notices, game HUD (Counter-Strike 2), weather face.
- Covered by something else: the AI usage ring. There is no official usage API to read, so a script feeds the progress ring (`matrix progress 63 CLAUDE`).
- Not built:
  - GPU load and temperatures: `sysinfo` reports neither reliably on Windows; needs vendor tools.
  - Stream Deck plugin: could not be tested without the hardware. A Stream Deck "Open" action running `matrix notify "text"` already works.
  - Discord/Teams mentions: reading other apps' notifications needs a packaged Windows app with the notification-listener permission.
  - Face-down reminders: phone app work (sensors), not started.

## Second pass: what makes a small display useful (2026-11-16)
Looked at what owners of other small displays keep on them (AWTRIX/Ulanzi pixel clocks, Tidbyt, Divoom Pixoo, the Framework 16 LED matrix, busylights) and at Nothing Community requests.

- The things people keep running are glanceable numbers that change: time, weather, a sensor or a counter. Tidbyt's install ranking starts with Weather; AWTRIX ships time, date, temperature and humidity, and owners mostly push their own sensor values to it.
- "Am I muted?" is a product category of its own (MuteMe, mütesync, Luxafor Mute Button): a light for mic state plus a physical button to flip it. MatrixMixer has both halves already: a matrix and a Glyph Button.
- Framework LED matrix owners ask for battery level, volume, temperatures, a network rate meter, and timers and reminders "for people with time-blindness".
- Visual-timer makers (Time Timer) and ADHD writers agree on one design: a shape that shrinks, always in view, beats a number you have to read.
- Nothing Community: the standing complaint is still "no killer use", and the standing request is notifications on the matrix without opening a toy.
- Decorative faces are popular too: Tidbyt's ranking includes Life, and a Framework app ships 100+ animations.

Candidates, most useful first:
1. Mic mute light and button: red ring while the mic is live, dark or a slashed mic when muted; a long-press of the Glyph Button mutes and unmutes the PC's microphone.
2. Next meeting as a shrinking disk: the last 30 minutes before the next calendar event drain like a Time Timer, instead of one notice.
3. Custom widget: show a number from any URL or command every N seconds (a Home Assistant sensor, unread count, queue length). This is how AWTRIX owners use theirs.
4. Reminders: "stand up" or "drink water" every N minutes, and one-off "remind me in 20 minutes", as notices.
5. PC battery ring and a volume flash when the volume changes.
6. Day progress: the working day as a ring.

Built from this pass (2026-11-16):
- Ambient animations (rain, starfield, Game of Life), as one widget with a style picker.
- Mic mute (1): the Glyph Button's "Mute / unmute microphone" flips the Windows microphone switch (`mic.rs`), and the on-air light holds still and reads MUTED. It cannot see the mute button inside Teams, Zoom or Discord.
- Meeting countdown (2): an option on the Calendar connector; after the warning, a disk drains until the event starts.
- Reminder (4): one recurring word as a connector. A one-off reminder is the Timer widget's countdown, so nothing new was added for it.

Left out on purpose, to keep the app to one idea per place:
- Custom widget (3): the HTTP API and `matrix` command already let a script push any number; a second way to do it in the UI would be a developer feature on the front page.
- Battery ring and volume flash (5), day progress (6): more shelf items for little daily use. Revisit if asked for.

## For later: the matrix changes with what you are doing
A Nothing Community post (pasted by the user on 2026-11-16, no link kept) asks for the always-on Glyph Matrix to follow the phone's activity: the music visualiser while music plays, the digital clock when idle, a controller icon while gaming, with rules people can edit "like essential notifications".

MatrixMixer could do the PC version of this, since it already knows most of the signals:
- Music playing (media session, `media.rs`) -> visualiser.
- Nothing going on -> clock, or whichever widget is chosen as the resting one.
- A game in the foreground (needs a foreground-window check, not built) -> a picture or the game HUD.
- Microphone or camera in use -> the on-air light (already automatic).

Open questions before building: where the rules live (one "When... show..." list, most likely next to Connectors), which rule wins when two apply, and how it sits with someone putting a widget up by hand. Not started.

## Sources
- [Tidbyt forum: App Ranking](https://discuss.tidbyt.com/t/app-ranking/3333)
- [AWTRIX 3](https://github.com/blueforcer/awtrix3)
- [Ulanzi TC001 with AWTRIX and Home Assistant](https://raspberry.tips/en/raspberrypi-tutorials/ulanzi-tc001-with-awtrix-and-home-assistant-display-smart-home-data-on-your-pixel-clock)
- [Framework: use cases for the LED Matrix module](https://community.frame.work/t/use-cases-for-the-led-matrix-module/39171)
- [Framework: led-matrix desktop app](https://community.frame.work/t/led-matrix-desktop-app-for-framework-16-led-matrix-modules-100-animations-games/84986)
- [Luxafor Mute Button](https://luxafor.com/product/luxafor-mute-button)
- [Time Timer: visual timers and procrastination](https://www.timetimer.com/blogs/news/breaking-the-cycle-how-visual-timers-can-help-adults-with-adhd-overcome-procrastination)
- [3 cheap tools that solve ADHD time blindness](https://adhdwithouttheguilt.substack.com/p/3-cheap-tools-that-solve-adhd-time)
- [Digital Trends: Nothing Phone 3 review](https://www.digitaltrends.com/phones/nothing-phone-3-review/)
- [Nothing Community: Glyph Matrix Glyph Toys concept](https://nothing.community/d/37445-glyph-matrix-glyph-toys-concept)
- [Luxafor + Stream Deck](https://luxafor.com/news/luxafor-integrates-with-elgato-stream-deck/)
- [iGoX BusyLight Stream Deck plugin](https://marketplace.elgato.com/product/igox-busylight-7448a0be-6dd6-4711-ba0d-86c52b9075b9)
- [Framework: LED matrix use cases](https://community.frame.work/t/use-cases-for-the-led-matrix-module/39171?page=3)
- [Aeroglyph weather toy](https://nothing.community/d/52633-release-aeroglyph-turn-your-glyph-interface-into-a-weather-station)
- [Glyph toys concept (reminders)](https://nothing.community/d/37445-glyph-matrix-glyph-toys-concept)
- [Android Authority: Glyph Matrix still feels like a gimmick](https://www.androidauthority.com/nothing-glyph-matrix-gimmick-3602057/)
- [Gizmodo: Nothing says the Phone 3 isn't one big gimmick](https://gizmodo.com/nothing-says-the-phone-3-isnt-one-big-gimmick-but-im-not-so-sure-2000623553)
- [NothingTec: You're misusing the Glyph Matrix](https://nothingtec.com/en/2026/01/27/estas-usando-mal-glyph-matrix-nothing/)
- [Pete Matheson: Nothing Phone 3 full review](https://www.petematheson.com/nothing-phone-3-the-full-review/)
- [Nothing Community: Glyph Matrix music visualization](https://nothing.community/d/37930-nothing-phone-3-glyph-matrix-music-visualization)
- [Nothing Community: The Great Glyph Matrix Toy Index](https://nothing.community/d/38769-the-great-glyph-matrix-toy-index)
- [Nothing Community: Community Glyph Matrix Toys collection](https://nothing.community/en/d/40994-community-glyph-matrix-toys-collection)
- [Nothing Community: 10 Days 10 Toys concepts](https://nothing.community/d/52615-10-days-10-toys-concepts-for-glyph-matrix)
- [Nothing Community: Glyph Matrix Tools](https://nothing.community/en/d/45099-nothing-phone-3-glyph-matrix-tools)
- [Nothing Community: Bigger matrix for a Pro version](https://nothing.community/d/36652-nothing-glyph-matrix-should-increase-in-size-for-the-pro-version)
- [Beebom: Nothing OS 4.0 wishlist](https://gadgets.beebom.com/guides/nothing-os-4-wishlist)
- [Beebom: Glyph Matrix guide](https://gadgets.beebom.com/guides/nothing-phone-3-glyph-matrix-guide)
- [9to5Google: Nothing OS 4.0 with Live Updates in Glyph](https://9to5google.com/2025/11/21/nothing-begins-android-16-rollout-with-live-updates-in-glyph-redesign-new-features/)
- [GlyphMatrix Developer Kit](https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit)
- [GlyphWorks](https://github.com/linuxct/glyphworks)
- [nothing-dot](https://github.com/kavastore/nothing-dot)
- [CgmGlyph](https://github.com/0NLyM/CgmGlyph)
- [custom-nothing-glyph-tools](https://github.com/SebiAi/custom-nothing-glyph-tools)
