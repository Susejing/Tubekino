# Tu servidor -- a Kino plugin for your own media server, and the SDK's demo plugin

A worked example for the [Kino](https://github.com/kinotvapp/kino-plugin-archive) plugin pattern
where the video source isn't a public site but a media server at home -- Jellyfin, Emby, a NAS, or
anything with a login and a JSON API in that shape. Instead of a fixed host in the manifest, the
person types their server's address, user and password the first time they configure the plugin.

It is also **the demo plugin of the whole SDK**: every feature a server of your own can use, up to
`apiVersion` 7 (Kino 0.9.51), is in `plugin.js`, and each one is exercised by a title or a route of
the bundled reference server (`server.mjs`), so you can install this plugin in Kino and watch every
feature work end to end without owning a real Jellyfin box. What it leaves out on purpose, and why,
is at the end of the table.

## Every feature, and where it is

`plugin.js` is one file; "where" names the function (or the manifest field) to read.

| Feature | Where | What shows it |
| --- | --- | --- |
| **The manifest** | | |
| No host of its own (`"hosts": []`, a `url` setting, apiVersion 2) | `kino-plugin.json` | the consent sheet lists no host, only "Se conectará a los servidores que escribas en su configuración" |
| `apiVersion` 7 | `kino-plugin.json` | Kino 0.9.50 and older refuse it: "Este plugin necesita una versión más nueva de Kino" |
| Marketplace tags (`categories`), `discoverable`, `color`, `icon` | `kino-plugin.json` | its card in Plugins ▸ Recomendados / De la comunidad |
| `debug` (the default of the "Modo debug" switch every plugin has) | `kino-plugin.json` (`false`: off until the person turns it on) | the plugin's tab in Ajustes |
| `telemetry` + `kino.log.report` (a degraded result: another address answered, Home served from the last copy) | `kino-plugin.json`; `reach`, `home` | consent line "Comparte registros de errores con Kino para corregir fallas" |
| Your own colors (`theme`) | `kino-plugin.json` | the section and the Ajustes tab; `node sdk/run.mjs . theme` |
| **Settings** (every type a setting can have) | | |
| `url`, `text`, `password` (required) | `kino-plugin.json`; `base`, `token` | "Falta configurar" until filled |
| `toggle` | "Solo HD" → `resolve` | `?quality=hd` on every file |
| `select` with a `default` | "Revisar lo nuevo" → `home` (the storage TTL) | Home asks again after 5, 15 or 60 minutes |
| `list` with `url` fields (each one an allowed host) | "Otras direcciones del mismo servidor" → `addresses`, `reach`, `withAddresses`, `signedStream` | the API falls back to them, each file gets them as labelled copies, the signed video as `alternateHosts` |
| `section` (with a hint over 80 characters, Kino 0.9.51) / `status` / `action` (one with `confirm`) | `kino-plugin.json` | the form in the plugin's tab |
| `settingsStatus` | `settingsStatus` | "Conectado a … como ana: 22 títulos" and "Último aviso: Big Buck Bunny: visto" |
| `action` (and `clearSettings`) | `action` | "Probar conexión"; "Cerrar sesión" (revokes the token, forgets the cache and cookies); "Usar el User-Agent de Kino" (empties `userAgent`) |
| `validateSettings` | `validateSettings` | a server typed with a path, a user with spaces, an address repeated, or a wrong password (checked against the saved server) are refused under their field |
| **Listing** | | |
| Search with `kino.rank` (`shortQuery`, `filterRelevant`, `sortBySimilarity`) on a loose backend; `type` as a hint only; a `Page` with `next` | `search` | search "Serie de prueba": the server also answers "Video de prueba 1"; the plugin drops it |
| `scopedSearch` (search inside a "Ver más" page, `within`, `null` when it can't) | `search` | "Buscar en esta categoría" on Novedades or a genre |
| Home rows with `ref` (Ver más), `genre`, and live items in a row (apiVersion 6) | `home`, `ROWS` | Inicio: Novedades, Series, En vivo |
| `kino.storage` with a TTL, and a permanent copy as the fallback | `home` | Home kept for the chosen minutes; served from the last copy if the server is down |
| `browse` with a cursor | `browse`, `refFilter` | "Ver más"; Categorías tiles |
| Item fields: `overview`, `genres`, `rating`, `runtimeMinutes`, `badges`, `quality`, `lang`, `ids.tmdb` + `ids.imdb` | `item` | "Big Buck Bunny": TMDB fills its info page |
| `adult: true` items and tiles (apiVersion 6) | `item`, `categories` | "Contenido 18+ (prueba)" and the "Adultos" tile, only with the 18+ code unlocked |
| Seasons as separate titles (`seasons`), episodes with `still`, `overview`, `airDate`, `runtimeMinutes` | `episodes` | "Serie de prueba": chips "Temporada 1" / "Temporada 2" |
| Your own section: tabs, a hero, rows (apiVersion 6) | `section`, `TABS` | the "Tu servidor" chip atop Inicio (phone), the sidebar entry (TV) |
| Categorías tiles (apiVersion 6) | `categories` | a "Tu servidor" group: Pruebas, Animación, Drama, Adultos |
| **Playing** | | |
| Offline downloads (`download`) | the manifest; `resolve` returns a progressive mp4 | "Descargar" on any movie or episode (phone only) |
| `audioTracks` | `resolve` | "Película con doblaje": "Español (doblaje de prueba)" in the audio menu |
| `subtitles` on the Stream | `resolve` | "Película con doblaje", "Big Buck Bunny" |
| `durationMs` + `skip` (this file's intro and credits) | `resolve` | "Película con doblaje": "Saltar intro" from 0:01 to 0:08, "Saltar outro" from 0:37 |
| `expiresInSeconds` | `resolve`, `resolveCopy` | a stale link is resolved again |
| Labelled and lazy copies (`label` + `alternatives`, `{ label, ref }`, apiVersion 6) | `withCopies`, `resolveCopy` | "Película con copias": Servidor menu; the third copy is resolved only when picked |
| The same file at the server's other addresses (labelled `alternatives`) | `withAddresses` | the Servidor menu, once "Otras direcciones" has one |
| Signing every request (`signing: "request"`, `signContext`, the `sign` export, `alternateHosts`, `resolve(ref, { retry })`, apiVersion 6) | `signedStream`, `sign`, `resolve` | "Video protegido": every playlist and segment request carries an HMAC good for 30 s |
| Typed errors (`kino.error`) with your own sentence (`userMessage`) | `api`, `resolveCopy` | "Error: no encontrado / limitado / región / no disponible"; "Mensaje de Tu servidor: …" |
| `kino.sleep` (a `Retry-After` of up to 3 s waited out once) | `api` | "Error: limitado" asks twice, then `rate_limited` |
| **Channels** (apiVersion 3) | | |
| Channels with a `ref` | `channel`, `resolve` | Noticias 1-3 |
| Channels with an inline `stream` (and a `ref` fallback) | `channel` | Deportes 1-3 |
| A playlist Kino downloads (M3U + XMLTV, `headers`, `streamHeaders`, `hideGroups`, `refreshHours`, `genre`) | `liveCategories` | Lista 1-3; "Televentas" (hidden by the plugin) and an adults entry (hidden by Kino) never show |
| A playlist whose links need the plugin (`resolve: true`) | `liveCategories`, `resolveListEntry` | Lista 4 |
| `genre` and `country` on categories | `liveCategories` | En vivo's genre filter |
| Paging with `next` | `liveChannels` | two channels a page |
| `liveSearch` | `liveSearch` | En vivo's search: "depor" before Deportes was opened |
| `guide` | `guide` | what is on now and next, in the TV guide |
| A User-Agent the channels insist on (`headers` on a Stream, `streamHeaders` on a playlist) | `agentHeaders` | try it with `node server.mjs --live-agent VLC` |
| **Any title, from any source** | | |
| `meta` with `logo`, `ratings` and `cast` (Kino 0.9.51) | `meta` | Big Buck Bunny from another source: a clear-logo, "IMDb 6.4 · Letterboxd 3.4/5" |
| `subtitles` export with Kino 0.9.51's `file` (hash, size, name) | `subtitles` | "Buscar subtítulos en línea": the subtitle timed for the playing file first, "… · para este archivo"; a `translated` one |
| `tracking` (apiVersion 7): `track(event)`, idempotency by `event.id`, `{ skipped: true }`, retry vs drop codes | `track` | red consent line; "Enviar lo que veo"; "Último aviso" in the form |
| `segments` (apiVersion 7) | `segments` | "Saltar intro" on Big Buck Bunny played from any source |
| `migrate` (apiVersion 6) | `migrate`, `movedTable` | saved titles, chapters and live favorites under the server's older ids move to the plugin |
| **The `kino` API** | | |
| `kino.fetch` (`method`, `body.json`, `headers`, `timeoutMs`), `KinoResponse.headers`/`json()` | `reach`, `api`, `validateSettings` | -- |
| `kino.config.get` / `kino.config.all` | everywhere / `validateSettings` | -- |
| `kino.storage.get/set({ ttlMs })/remove/keys` | `token`, `home`, `movedTable`, `action` | -- |
| `kino.cookies.clear` | `action` ("Cerrar sesión") | -- |
| `kino.crypto.hmac`, `kino.crypto.uuid` | `sign`, `clientHeaders` | -- |
| `kino.appVersion`, `kino.apiVersion`, `kino.lang` | `clientHeaders` (`X-Client`, `Accept-Language`) | -- |
| `kino.log` (never a title or a value) and `kino.log.report` | `resolve`, `track`, `validateSettings`; `reach`, `home` | the Registro, with Modo debug on |

### What this plugin does not use, and why

A server at home never needs these, so the reference plugin would only fake them. The guide has a
recipe or a section for each.

- **Widevine DRM** (`drm`): a home server serves clear files. ("A Widevine-protected stream".)
- **A declared host over plain `http`** (`insecureHttp`) and **any host** (`streamHosts`, `liveStreamHosts`,
  `fetchHosts`): every byte here is on the server the person typed, which may already be `http`; the strict
  rule is the right one. ("A site of yours without a certificate", "Live channels: three recipes".)
- **Sealed secrets** (`secrets`, `kino.secret`): they hide a key baked into a site's own client; a server of
  your own has the person's own account instead. ("Sealed secrets".)
- **The author's signature** (`signature`, apiVersion 5): this is a teaching example people copy; sign your own
  plugin with `node sdk/seal.mjs --sign`. ("Signed plugins".)
- **The hidden browser** (`browser`, `kino.browser.capture` / `page`) and **`kino.html.select`**: a media
  server answers JSON; there is no page to run or parse. ("Opening hidden web pages".)
- **Key pairs** (`kino.crypto.generateKeyPair`, `sign`, `verify`, `deriveSharedSecret`): the server's login is a
  password; `kino.crypto.hmac` is what its signed video needs.

For the general plugin format -- the manifest, the functions, the full `kino` API, every limit --
see the guide, [`GUIDE.md`](GUIDE.md) (the same file as in every Kino plugin repository), or its
online version at <https://kinotvapp.github.io/kino-plugins/> (start at [Example plugins](https://kinotvapp.github.io/kino-plugins/examples/) and [The contract](https://kinotvapp.github.io/kino-plugins/contract/)). This README
covers what's specific to the "own server" pattern and to each demo.

## Run the reference server

```
node server.mjs [--port 8096] [--user ana] [--password s3cr3t] [--live-agent VLC]
```

With `--live-agent VLC` the live channels answer `403` to any player whose User-Agent does not contain `VLC`:
type `VLC/3.0.20 LibVLC/3.0.20` in the plugin's settings ("User-Agent de los canales") and they play
again; "Usar el User-Agent de Kino" empties the field.

No dependencies -- just `node:http`, `node:fs`, `node:crypto` and `node:zlib`. On start it prints the addresses
another device on your network can type (for example `http://192.168.1.10:8096`). If your computer's firewall
asks, allow incoming connections for `node`.

The catalog, and what each entry is for:

| Title | Kind | What it demonstrates |
| --- | --- | --- |
| Video de prueba 1 | movie | a plain progressive mp4 (`media/video1.mp4`, 3 s of test pattern): plays and downloads; `badges`, `quality` |
| Big Buck Bunny | movie | `ids.tmdb` 10378 and `ids.imdb` tt1254207, streaming the 45 s clip: Kino fills the info page from TMDB, and asks this server about it **from any source**: its intro and credits (`segments`), its subtitles (one timed for the served file's OpenSubtitles hash), its clear-logo, ratings and cast (`meta`); playing it is reported (`track`) |
| Película con doblaje | movie | a 45 s clip (`media/doblaje.mp4`, test pattern with a frame counter and a steady low tone) plus a separate 45 s audio file (`media/audio-es.m4a`, a fast high beep) as an `audioTracks` entry; a subtitle; `durationMs` and `skip` |
| Película con copias | movie | three labelled copies (`Stream.label` + `alternatives`): two come with the title, the third is a lazy `{ label, ref }` that `resolve("copias|c")` answers when the person picks it (`/items/copias/copies/c`) |
| Video protegido | movie | 6 s of HLS (`media/protegido/`) whose every request must carry `X-Time` and `X-Signature` (HMAC-SHA256 of `<time>:<path>` with the session's key, 30 s) |
| Contenido 18+ (prueba) | movie | `adult: true`: only with the 18+ code unlocked |
| Serie de prueba | series | season 1 (3 episodes); lists both seasons in `seasons` |
| Serie de prueba (Temporada 2) | series | season 2 (2 episodes), its own title |
| Noticias 1, 2, 3 | live | listed by `/channels` and given with a `ref` (`canal-1` keeps the id the single test channel had in 1.1) |
| Deportes 1, 2, 3 | live | listed by `/channels` and given with an inline `stream` (and the `ref` as fallback) |
| Lista 1, 2, 3 | live | the entries of `/lista.m3u`, with a guide in `/guia.xml.gz` |
| Lista 4 | live | the entry of `/lista-token.m3u`, whose link (`/channels/canal-10/play`) needs the token: `resolve: true` |
| Error: no encontrado / limitado / región / no disponible | movie | `resolve` fails with 404 / 429 (`Retry-After: 1`) / 451 / 503 -> `not_found` / `rate_limited` / `geo_blocked` (with the plugin's own sentence) / `unavailable` |

The API, all under the typed address:

| Route | Token | Answer |
| --- | --- | --- |
| `POST /auth` `{user, password}` | -- | `{token}` or 401 |
| `DELETE /session` | `X-Token` | 204; that token stops working ("Cerrar sesión") |
| `GET /status` | `X-Token` | `{name, version, titles, user}` (the form's status line and "Probar conexión") |
| `GET /items?kind=&genre=&q=&limit=&cursor=` | `X-Token` | `{items: [{id, kind, title, year, tmdb?, imdb?, overview?, genres?, rating?, runtime?, badges?, quality?, lang?, adult?}], next?}`; `q` matches ANY word of 3+ letters, on purpose |
| `GET /items/<id>[?fresh=1]` | `X-Token` | a movie or episode: `{stream, audio, subtitles, durationMs?, skip?, copies?}`; the signed video: `{hls, session: {id, key}}` (`fresh=1`: a new session); a season: `{show, season, episodes, seasons}`; a channel: `{stream}` |
| `GET /items/<id>/copies/<copy>` | `X-Token` | `{stream}` of one copy |
| `GET /genres` | `X-Token` | `[{id, title, art, adult?}]` (Categorías, the section's rows) |
| `GET /moved` | `X-Token` | `{titles, episodes, channels}`: the server's older ids (`migrate`) |
| `GET /segments?imdb=&tmdb=&showImdb=&showTmdb=&season=&episode=&duration=` | `X-Token` | `[{type, startMs, endMs}]` for a title of the library, for a cut of the same length (±5 s) |
| `GET /subtitles?imdb=&tmdb=&season=&episode=` | `X-Token` | `[{lang, label, release, translated, file, format, hash?}]` |
| `GET /meta?type=&imdb=&tmdb=` | `X-Token` | `{id, title, year, overview, genres, runtime, ratings, cast}` or 404 |
| `POST /playing` (a tracking event; `Idempotency-Key`) | `X-Token` | `{ok: true}` for a title of the library, `{ignored: true}` for any other; a repeated event id is recorded once |
| `GET /playing` | `X-Token` | `{count, last}` |
| `GET /stream/v1`, `GET /stream/doblaje`, `GET /stream/audio-es` | -- | the progressive files, with `Range` support |
| `GET /subs/<id>.<lang>.vtt` | -- | a subtitle, three cues |
| `GET /secure/protegido/index.m3u8`, `GET /secure/protegido/<n>.ts` | signed | the signed video; 403 without a fresh signature |
| `GET /live/canal-<1-10>.m3u8`, `GET /live/canal-<1-10>/<n>.ts` | -- | a channel's live HLS playlist (computed from the clock) and its segments: each channel loops its own three 2-second segments (`media/live/canal-N/`: its own colour and name, a moving bar, a tone of its own pitch) |
| `GET /channels/categories` | `X-Token` | `[{id, title, country, genre}]`: Noticias and Deportes |
| `GET /channels?category=<id>&limit=&cursor=` | `X-Token` | `{items: [{id, title, number, categoryId}], next?}` |
| `GET /channels/search?q=` | `X-Token` | `{items}`: the listed channels whose name has `q` |
| `GET /channels/<id>/play` | `X-Token` | `{stream}` (the links of `/lista-token.m3u`) |
| `GET /channels/guide?ids=<id,id>&from=<ms>&to=<ms>` | `X-Token` | `[{channelId, title, start, end, description}]`: one programme an hour over the window (at most 24) |
| `GET /lista.m3u` | `X-Token` | an M3U list: Lista 1-3 in group "Lista de prueba", plus "Televentas" in "Compras" and one entry in "Adultos" |
| `GET /lista-token.m3u` | `X-Token` | an M3U list: Lista 4, linked to `/channels/canal-10/play` |
| `GET /guia.xml.gz` | `X-Token` | its XMLTV guide, gzipped: six hourly programmes per Lista channel, starting an hour ago |
| `GET /img/poster/<id>.png`, `GET /img/backdrop/<id>.png`, `GET /img/logo/<id>.png` | -- | a title's poster (300x450), backdrop (480x270; an episode's id gives its still) or clear-logo (600x150, transparent), drawn on request by `artwork.mjs`; a cast member's id gives their photo; `GET /img/<id>` is the poster too |

Media routes need no token because the player fetches them without one; a real server would put a
short-lived token in the URL or return `headers` with the `Stream`. Images are loaded by Kino
without your headers either, so artwork has to be reachable as a plain URL.

The artwork is drawn by `artwork.mjs` in plain Node (a 5x7 bitmap font and a hand-written PNG
encoder, no packages): a colour picked from the title's id, the title in big letters (uppercase, no
accents), a label on top ("PELICULA", "SERIE - TEMPORADA 2", "T1 - EPISODIO 3", "EN VIVO", "REPARTO") and
"TU SERVIDOR" at the bottom; the clear-logo is the title alone on a transparent background. Nothing is
committed: each image is drawn on first request, about 2 KB.

## Install it in Kino

In Kino, **Ajustes ▸ Plugins ▸ Agregar**, type this repository's `owner/repo`:

```
kinotvapp/kino-plugin-own-server
```

It needs a Kino build that knows apiVersion 7 (Kino 0.9.51); an older one refuses it with "Este plugin
necesita una versión más nueva de Kino". The consent sheet lists no host (see "Why the manifest declares no
host" below), then:

- "Este plugin usa tu usuario y contraseña" (the `password` setting)
- "Se conectará a los servidores que escribas en su configuración" (the `url` setting)
- "Puede descargar videos para verlos sin conexión" (`download`)
- "Agrega canales en vivo a la pestaña En vivo" (`channels`)
- "Revisar lo que tienes guardado (biblioteca, historial, favoritos) para pasarlo a este plugin" (`migrate`)
- "Agrega subtítulos a tus películas y series" (`subtitles`)
- **in red**, "Le contará al servidor que escribas en su configuración qué ves y cuándo lo terminas" (`tracking`)
- "Agrega el botón para saltar la intro y los créditos" (`segments`)
- "Comparte registros de errores con Kino para corregir fallas" (`telemetry`)

Updating from 1.4 asks for approval again (`migrate`, `tracking` and `telemetry` are new). Once installed the
plugin shows **Falta configurar**; open its tab in Ajustes and fill in:

- **Servidor**: `http://192.168.1.10:8096` -- your server's LAN address, or one of the addresses
  `server.mjs` printed (from *another* device on the same network as your phone/TV; see "Why not
  127.0.0.1").
- **Usuario** / **Contraseña**: whatever `server.mjs` was started with (`ana` / `s3cr3t` by default).

"Conexión" then reads "Conectado a Tu servidor (referencia) 1.5.0 como ana: 22 títulos". Then, on the phone:

1. **Inicio** shows three rows from "Tu servidor": Novedades, Series, En vivo (the ten channels) --
   each card with its own colour and title -- and a **Tu servidor** chip at the top that opens the
   plugin's own section, in its own colours, with the tabs Películas / Series / En vivo.
2. **Película con doblaje**: play it, open the audio menu, pick "Español (doblaje de prueba)" -- the
   steady low tone gives way to a fast high beep. "Saltar intro" shows during the first seconds,
   "Saltar outro" from 0:37, and its subtitle is in the subtitle menu.
3. **Serie de prueba**: the info page shows the chips "Temporada 1" and "Temporada 2".
4. **Noticias 1** from the En vivo row: opens straight into the player with the live overlay.
5. **Video de prueba 1** (or any movie or episode): "Descargar" on the info page. A channel, and the signed
   video, are never offered for download.
6. **Big Buck Bunny**: the info page carries TMDB's cast, director and tagline. Play it to the end:
   "Último aviso" in the plugin's tab now reads "Big Buck Bunny: visto". Its "Saltar intro" comes from
   `segments`, so it also shows when the same film plays from another source.
7. **Película con copias**: the Servidor menu lists three copies; the third opens only when picked.
8. **Video protegido**: plays though every request is signed (`sign()`, through Kino's local proxy).
9. Search **Serie de prueba**: only the two seasons come back from this plugin; inside **Ver más** of
   Novedades, "Buscar en esta categoría" asks the server for that row only.
10. **Categorías**: a "Tu servidor" group with Pruebas, Animación, Drama (and Adultos, with the 18+ code unlocked).
11. **En vivo**: a "Tu servidor" section with Noticias, Deportes, "Lista de prueba" and "Lista con enlace por
    canal". "Televentas" (group "Compras", hidden by the plugin) and the entry in "Adultos" (hidden by Kino)
    never appear. Searching "depor" finds Deportes 1-3 even before the category was opened.

## Why the manifest declares no host

This plugin only ever talks to the server the person types (and its other addresses, if they list
them), so `kino-plugin.json` declares `"hosts": []`. That is allowed from `"apiVersion": 2` for a
plugin with at least one `url` setting (without one, `node sdk/validate.mjs .` refuses it the way
Kino does: "El campo \"hosts\" solo puede estar vacío si el plugin tiene un ajuste de tipo \"url\"").
The typed server -- and every `url` field of the "Otras direcciones del mismo servidor" list --
becomes an allowed host for this install once the person saves the form, and the consent sheet
announces it with its own line, "Se conectará a los servidores que escribas en su configuración".
With no host, the `tracking` line names no host either: "Le contará al servidor que escribas en su
configuración qué ves y cuándo lo terminas".

Up to 1.1.1 the manifest declared the placeholder `"tu-servidor.invalid"` (a reserved name that never
resolves) so that Kino builds from before that rule would still install it. 1.2 is apiVersion 3,
which those builds refuse anyway, so the placeholder is gone. If your own plugin also fetches
something from the internet (a metadata API, your project's site), declare that host.

## Why not 127.0.0.1

A loopback address is refused, both by the app's settings form and by this repository's own
`sdk/` kit -- on a phone or TV, `127.0.0.1` means that device itself, never a real server elsewhere
on the network, so Kino treats it as almost certainly a mistake. Point at your machine's actual LAN
address instead (`ipconfig getifaddr en0` on a Mac, `hostname -I` on Linux).

## About the bundled token

`plugin.js` caches its login token in `kino.storage`, keyed by `user@server` -- not by password. If
you only change the password without changing the user or server, the plugin still has a token from
the earlier, correct login and keeps working until the server itself rejects it (this reference
server never does on its own -- it keeps every token it issued until "Cerrar sesión" revokes it). A
real server that expires or revokes tokens triggers a fresh login: `api` forgets a token the server
answers 401 to and tries once more with a new login. `validateSettings` does check a changed password
against the saved server before it is saved.

The Home cache is keyed by `user@server` for the same reason: `kino.storage` survives a change in
the settings, and a key without them would show the old server's rows. It is written with
`{ ttlMs }` from the "Revisar lo nuevo" setting, so after that long `kino.storage.get` returns `null`
by itself and the rows are asked for again -- no timestamp bookkeeping in the plugin. "Cerrar sesión"
removes every key of the account (the token, Home, the moved-ids table) and the cookie jar; only the
install's random client id (`client-id`) stays.

## Notes on each feature

- **Downloads.** Kino calls `resolve` when a download runs and saves the `Stream` as one file, so
  only progressive files download; the HLS channels are refused ("Este video no se puede descargar"),
  and so is the signed video. `audioTracks` are not saved: an offline "Película con doblaje" has only the
  clip's own audio.
- **Seasons.** This server keeps each season as its own title, so `episodes(ref)` returns only that
  season's episodes and lists every season in `seasons`, with `current: true` on the one answered.
- **Live.** A `live` item needs `"apiVersion": 2`; in a Home row it stays from apiVersion 6. Its `ref`
  goes to `resolve`; when the stream cuts, Kino calls `resolve` again by itself.
- **Artwork.** `poster`, `backdrop`, `still`, a category's `art`, `meta`'s `logo` and a cast `photo` must
  normally be `https`; on the server the person typed, `http` and a LAN address work too.
- **`kino.rank`.** `search` asks the server with `kino.rank.shortQuery(q)`, then keeps what
  `filterRelevant` accepts against every form of the title Kino knows (`q`, `originalTitle`,
  `altTitles`) and orders it with `sortBySimilarity`; `type` only puts its kind first.
- **Other addresses.** "Otras direcciones del mismo servidor" is for the same server reached another way
  (its LAN address and its public name). When the main address does not answer at all, `reach` tries them
  in order and reports the fallback with `kino.log.report("own_server:address", …)`; every file also lists
  them as labelled copies, and the signed video as `alternateHosts` (same scheme only). Artwork keeps the main
  address.
- **Signing.** `resolve` returns `signing: "request"`, the session id as a plain header and the session key
  in `signContext`; `sign()` runs apart (no network, no storage: only `kino.crypto`), within 1.5 s, and
  computes `X-Time` and `X-Signature` for the exact path asked. If the server still refuses (409, or 401/403
  twice), Kino calls `resolve(ref, { retry })` and the plugin asks for a fresh session (`?fresh=1`).
- **Tracking.** Kino keeps every event in its own queue until `track` delivers it (offline, app closed),
  in order, with the same `event.id` on every retry -- sent as `Idempotency-Key`, so the server records a
  repeat once. A title this server does not have (one played from another source) answers
  `{ ignored: true }`, and the plugin returns `{ skipped: true }`: dropped, never an error, but not a
  delivery either (only a real one clears the red "No pudo avisar…" line). `unavailable`, `rate_limited`
  and network trouble are retried later; `auth_required` and `not_found` drop the event. The plugin logs
  the event type and the outcome, never the title.
- **Segments and `skip`.** The plugin's own files carry `skip` in the Stream (it wins); `segments` answers
  for titles known by id, from any source, for the playing cut (`durationMs`, ±5 s on this server).
- **Subtitles.** `subtitles` sorts the subtitle timed for the playing file first (by `file.hash`, the
  OpenSubtitles hash Kino 0.9.51 computes, or by `file.name`), then the person's languages, a machine
  translation (`translated: true`) last in its language.
- **Meta.** Only fills what TMDB left empty on the info page: here the clear-logo, the ratings (which add up
  next to TMDB's score) and the cast (shown only when TMDB has none). The cast is made up, and named so.
- **Migrate.** Kino offers the saved values no source opens any more, one by one, in the background; the
  plugin reads the server's table of older ids once (`/moved`, kept an hour) and answers each from it,
  `null` for anything not there.

## Channels (apiVersion 3)

With `"apiVersion": 3` and `"channels"` in `capabilities`, Kino calls `liveCategories`, `liveChannels`
and, optionally, `liveSearch` and `guide`, and shows what they give in its own En vivo tab, TV guide,
channel drawer and Home "Canales en vivo" row, in a section named after the plugin. `plugin.js` gives
every shape a plugin can use, mixed in one answer:

1. **A `ref`** (Noticias): the ref goes to `resolve()` when the person plays the channel, exactly
   like a `live` item's. Use it when playing needs the plugin: a fresh token, a per-channel lookup.
2. **An inline `stream`** (Deportes): checked by the same rules as `resolve()`'s answer and played
   with no call to the plugin at all -- the fastest zapping. Its `ref` is only the fallback.
3. **A playlist** (Lista de prueba): Kino downloads the M3U list and its XMLTV guide itself, with the
   `headers` given, and groups the entries into categories by `group-title`. `hideGroups` hides
   groups by title (case doesn't matter); groups such as "Adultos" are always hidden.
4. **A playlist with `resolve: true`** (Lista con enlace por canal): the same, but each entry's link goes
   to `resolve(<entry url>)`, for lists whose links need the plugin (here, the token).

The lists, their guide and every stream are on the server the person typed, so the strict host rule
covers them: no `liveStreamHosts` here.

Try each shape against the reference server (`--config` as in "Develop and test" below):

```
node sdk/run.mjs . live categories          # the two categories, then both playlists as Kino reads them:
                                            #   3 canales en 1 categorías; 0 entradas descartadas; 2 ocultas (adultos)
                                            #   1 canales en 1 categorías; 0 entradas descartadas; 0 ocultas (adultos)
node sdk/run.mjs . live channels noticias   # two channels with a ref and next "2"; plays the first through resolve()
node sdk/run.mjs . live channels noticias 2 # the third
node sdk/run.mjs . live channels deportes   # channels with an inline stream (and a ref fallback)
node sdk/run.mjs . live search depor
node sdk/run.mjs . live guide canal-1,canal-4
node sdk/validate.mjs . --run liveCategories   # also downloads and parses the playlists; exit 0 = accepted
```

## Develop and test

With the server running (`node server.mjs`) and your LAN address in `--config` (or in `sdk/config.json`,
kept out of git -- the only way to give the `addresses` list, which is JSON):

```
node sdk/validate.mjs .
C="--config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t"
node sdk/run.mjs $C . home
node sdk/run.mjs $C . search "Serie de prueba"
node sdk/run.mjs $C --within movie . search doblaje
node sdk/run.mjs $C . browse genre:animacion
node sdk/run.mjs $C . episodes serie-t1
node sdk/run.mjs $C . resolve doblaje
node sdk/run.mjs $C . resolve copias            # then: resolve 'copias|c'
node sdk/run.mjs $C . resolve protegido         # then: sign '{"url":"http://192.168.1.10:8096/secure/protegido/0.ts","kind":"segment","ref":"protegido","context":"<signContext>"}'
node sdk/run.mjs $C --retry expired:1:403 . resolve protegido
node sdk/run.mjs $C . section                    # and: section series, section en-vivo
node sdk/run.mjs $C . categories
node sdk/run.mjs . theme
node sdk/run.mjs $C . migrate '{"kind":"title","ref":"big-buck-bunny-2008"}'
KINO_LANGS=es,en node sdk/run.mjs $C . subtitles tt1254207
node sdk/run.mjs $C . track watched '{"ids":{"imdb":"tt1254207","tmdb":10378},"title":"Big Buck Bunny"}'
node sdk/run.mjs $C . segments tt1254207 45000
node sdk/run.mjs $C . settingsStatus
node sdk/run.mjs $C . action probar              # and: action quitarAgente, action salir
node sdk/run.mjs $C . validateSettings '{"server":"http://192.168.1.10:8096","user":"ana","password":"mala"}'
node --test test/*.test.mjs
node --test sdk/test/kit.test.mjs
```

The kit has no command for `meta`; `test/plugin.test.mjs` calls it directly.

`node --test test/*.test.mjs` runs fully offline against `test/fixtures.json`, recordings of real exchanges
with `server.mjs` (made with `node sdk/run.mjs --record <file> ...`, one file per command merged into one, the
address then rewritten to `192.168.1.10`; the two M3U lists, which Kino downloads itself, added the same way)
-- no server needs to be running. They cover every export above, the consent sheet, the settings form, the
three channel shapes and both playlists, signing (the HMAC `sign()` computes is checked against Node's own),
the `file` hint of `subtitles`, `{ skipped: true }` from `track`, and `artwork.mjs` itself (sizes, same bytes
every time, a different image per title, a transparent logo). The last line runs the kit's own tests.

The segments in `media/live/canal-N/` and `media/protegido/` are committed; `node media/make-live.mjs [id…]`
(needs ffmpeg) draws them again from `artwork.mjs` -- give the ids you changed, since ffmpeg's output is not
byte-stable.

To try the server while another copy is already running, start it on another port:
`node server.mjs --port 8123`.

`sdk/`, `contract.json`, `kino.d.ts` and `GUIDE.md` are a copy of Kino's plugin kit (apiVersion 7, Kino 0.9.51);
`sdk/kino-rank.mjs` is the same ranking code the app runs, and `sdk/live-playlist.mjs` the same M3U
and XMLTV rules. Two local differences: `sdk/test/kit.test.mjs` looks for the example plugin at this
repository's root, and `sdk/contract.mjs` allows a `section` setting's hint up to 300 characters
(`sectionHintMaxChars`), as the app does, where the kit still applied the 80 of every other hint.

## License

The code in this repository is licensed under the [Apache License 2.0](LICENSE). Copyright 2026 kinotvapp.

## License note

`plugin.js`, `server.mjs`, `artwork.mjs` and the bundled test media (`media/`, generated with ffmpeg's test
sources) are original to this example and free to copy into your own plugin, same as the rest of the
pattern in the guide.
