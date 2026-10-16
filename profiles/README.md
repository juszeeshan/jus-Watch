# Watch profiles

One JSON file per watch family. List the file name in `index.json` and WatchSync loads it on start.

## Fields
| Field | Meaning |
|---|---|
| `id`, `name` | Identifiers shown in the app |
| `namePrefixes` | Bluetooth device names that start with any of these match the profile |
| `verified` | `false` makes the app ask for confirmation before sending any bytes from this profile |
| `services` | Custom service UUIDs to request before connecting (4-hex shorthand or full 128-bit) |
| `battery` | `{ "service": "...", "characteristic": "...", "offset": 0 }`, a readable characteristic holding the percentage in one byte |
| `syncTime` | `{ "service": "...", "characteristic": "...", "template": "...", "checksum": "sum8" }` |

## Packet templates
Space-separated parts: literal hex bytes (`01`, `ff`) or tokens in braces.

- Tokens: `year`, `year2`, `month`, `day`, `hour`, `minute`, `second`, `weekday` (1=Mon..7=Sun), `weekday0` (0=Sun)
- Formats: `{hour}` is one byte; add `:bcd`, `:le16` or `:be16`, e.g. `{year2:bcd}`, `{year:le16}`
- `checksum` (optional): `sum8` or `xor8`, appended as the last byte

Example: `"template": "01 {year2:bcd} {month:bcd} {day:bcd} {hour:bcd} {minute:bcd} {second:bcd}"` with `"checksum": "sum8"`.

## Adding a new watch
1. Connect in WatchSync and press **Save profile draft**; it writes a JSON skeleton with the services it found.
2. Work out the byte formats with nRF Connect and the Android Bluetooth HCI snoop log.
3. Fill in `battery` and `syncTime`, set `verified` to `true` only after testing on a real watch, add the file to `index.json`.
