# What the Nothing community wants (researched 2026-11-13)

Web research into what Phone (3) owners ask for from the Glyph Matrix, and how it lines up with Matrix Bridge. Most sources are from mid to late 2025; none is a survey, so these are recurring requests, not ranked demand.

## Headline findings
- The most repeated criticism is that the Glyph Matrix is a gimmick with nothing practical to show (Android Authority, Gizmodo, several reviews). Nothing publicly disputes this. Matrix Bridge's pitch: the matrix becomes a useful status light for your desk.
- No existing project was found that drives the matrix live from a PC. Everything else runs on the phone.
- Nothing's SDK now also lists the Phone (4a) Pro, with a 13x13 matrix. Matrix Bridge assumes 25x25 everywhere.

## Requests and fit

| Community want | Evidence | Fit with Matrix Bridge |
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

## Sources
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
