# MatrixMixer protocol, version 1

JSON text messages over a WebSocket. **The phone is the server** (default port `8765`), the PC is the client. Every message is an object with a `t` field naming its type.

The protocol is implemented in three places that must stay in step:

| Where | File |
|---|---|
| PC (TypeScript) | `core/src/protocol.ts`, `core/src/client.ts` |
| Phone (Kotlin) | `android/.../Protocol.kt`, `android/.../BridgeServer.kt` |
| Test phone (TypeScript) | `cli/src/sim.ts` |

## Finding the phone

The phone advertises the DNS-SD service `_matrixbridge._tcp` on the local network. Networks that block device-to-device traffic (most college Wi-Fi) also block this. Fallbacks: type the phone's IP address, or use USB with `adb forward tcp:8765 tcp:8765` and connect to `127.0.0.1`.

## Conversation

```
PC                                   Phone
 |  ---- WebSocket connect ------->   |
 |  <--- hello ---------------------  |
 |                                    |
 |  first time:                       |
 |  ---- pair {code, name} -------->  |   code is shown in the phone app
 |  <--- paired {token} ------------  |   PC stores the token
 |  <--- ready ---------------------  |
 |                                    |
 |  every time after:                 |
 |  ---- auth {token} ------------->  |
 |  <--- ready ---------------------  |
 |                                    |
 |  ---- frame / brightness / clear ->|
 |  <--- event (Glyph Button) ------  |
 |  ---- ping --------------------->  |   every 5 s
 |  <--- pong ----------------------  |
```

Anything other than `pair`, `auth` and `ping` is answered with `error unauthorized` until the connection has paired or authenticated.

## PC to phone

| `t` | Fields | Meaning |
|---|---|---|
| `pair` | `code`: 6-digit string, `name`: string | Pair using the code on the phone's screen. |
| `auth` | `token`: string, `name`?: string | Reconnect with a token from an earlier `paired`. |
| `frame` | `px`: array of 625 integers, 0-255 | One image. Row by row from the top-left, 25 per row. |
| `brightness` | `value`: integer 0-255 | Global multiplier applied to every frame. |
| `clear` | | Turn the matrix off and forget the last frame. |
| `ping` | | Keep-alive. Answered with `pong`. |

The matrix is round: only 489 of the 625 cells are LEDs. Row widths from top to bottom are `7 11 15 17 19 21 21 23 23 25 25 25 25 25 25 25 23 23 21 21 19 17 15 11 7`, centred. Values for the missing corner cells are ignored.

The phone draws at most about 30 frames a second and keeps only the newest frame if they arrive faster.

## Phone to PC

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | `v`: protocol version, `device`, `name`, `size`: 25 | Sent as soon as the socket opens. |
| `paired` | `token`: string | Pairing worked. Followed by `ready`. |
| `ready` | | Frames are now accepted. |
| `status` | `toy`: boolean | Whether the PC Remote toy is the selected Glyph Toy. Sent after `ready` and on every change. |
| `event` | `source`: `"button"`, `action`: `"long"` \| `"down"` \| `"up"` | Glyph Button activity. Only while `toy` is true. |
| `pong` | | Answer to `ping`. |
| `error` | `code`, `message` | See below. The connection stays open. |

Error codes: `bad_code` (wrong pairing code), `locked` (5 wrong codes; pairing refused for 30 s and the code changes), `bad_token` (token unknown, pair again), `unauthorized` (sent a command before pairing), `bad_message` (malformed or unknown message).

## Rules worth knowing

- A pairing code works once. After a successful pairing the phone shows a new one.
- Tokens never expire. The phone forgets one when the user taps **Forget** next to that PC.
- When the last PC disconnects the phone keeps the current frame for 30 seconds, then blanks the matrix.
- Several PCs may be connected at once. The newest frame wins.
- Either side may drop a silent connection: the PC after 13 s without any message, the phone after 15 s without a WebSocket pong.
