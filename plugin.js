/// <reference path="./kino.d.ts" />
// Tu servidor -- a Kino plugin for a media server at home (Jellyfin, Emby, a NAS...), and the demo
// plugin of the whole SDK: every feature a server of your own can use, up to apiVersion 7 (Kino 0.9.51),
// is here, each one exercised by a title of the bundled reference server (README.md, "Every feature,
// and where it is"). What is deliberately left out, and why, is in README.md, "What this plugin does
// not use".
//
// The person types the server's address, user and password in its tab in Ajustes; the address (and
// the other addresses of the same server they list) becomes an allowed host for this install only (the
// manifest declares no host of its own: `"hosts": []`), so `http://` and a LAN address are both fine
// here -- that would be refused for any host a plugin declares in its manifest. A loopback address
// (127.0.0.1) is refused even here: on a phone it would mean the phone itself, never a real server.
//
// Run a real server to try this against: `node server.mjs` (see README.md), then, from your
// computer's own LAN address (not 127.0.0.1 -- see above):
//   node sdk/run.mjs . --config server=http://192.168.1.10:8096 --config user=ana --config password=s3cr3t search prueba

const VERSION = "1.5.0";
const HLS = "application/vnd.apple.mpegurl";

const trimSlash = (u) => String(u).replace(/\/+$/, "");
const base = () => trimSlash(kino.config.get("server") || "");
const enc = encodeURIComponent;

// The other addresses of the SAME server (the `list` setting "addresses": its LAN address and its public
// name, say). Each `url` field is an allowed host too. Used three ways: the API falls back to them when
// the main address does not answer (`reach`), every file gets them as labelled copies (`withAddresses`),
// and the signed video as `alternateHosts` (`signedStream`).
const addresses = () =>
  (kino.config.get("addresses") || []).map((a) => ({ url: trimSlash(a.url), label: (a.label || "").trim() || new URL(a.url).host }));

// Everything cached in kino.storage belongs to one user on one server: storage survives a change
// in Configurar, so a key without them would hand the old server's answers to the new one.
const scope = () => kino.config.get("user") + "@" + base();

// The token does NOT change when only the password changes for the same user@server -- a
// still-valid token keeps working, exactly like a real session would, until the server rejects it.
const tokenKey = () => "token:" + scope();

// Who is asking, the way a Jellyfin client says it: Kino's version and language, this plugin's version, and
// a random id for this install (kino.crypto.uuid, kept in kino.storage: per device, never in a setting --
// settings travel to the person's other devices). Headers only, so the Node kit's recordings still match.
function clientHeaders() {
  let id = kino.storage.get("client-id");
  if (!id) kino.storage.set("client-id", (id = kino.crypto.uuid()));
  return {
    "X-Client": `Kino/${kino.appVersion} own-server/${VERSION} api/${kino.apiVersion}`,
    "X-Client-Id": id,
    "Accept-Language": kino.lang,
  };
}

// One request, to the main address and, when it does not answer at all (network or timeout), to the other
// addresses in order. A fallback is a degraded result even though the call works: kino.log.report tells
// Kino's error tracker (the manifest declares `"telemetry": true`), at most once an hour per area.
async function reach(path, init = {}) {
  const options = { ...init, headers: { ...clientHeaders(), ...init.headers } };
  try {
    return await kino.fetch(base() + path, options);
  } catch (e) {
    if (e.code !== "network" && e.code !== "timeout") throw e;
    const others = addresses();
    for (let i = 0; i < others.length; i++) {
      try {
        const r = await kino.fetch(others[i].url + path, options);
        kino.log.report("own_server:address", "main_unreachable", "fallback=" + (i + 1));
        return r;
      } catch (again) {
        if (again.code !== "network" && again.code !== "timeout") throw again;
      }
    }
    throw e;
  }
}

async function token() {
  await null;
  const saved = kino.storage.get(tokenKey());
  if (saved) return saved;
  const r = await reach("/auth", {
    method: "POST",
    body: { json: { user: kino.config.get("user"), password: kino.config.get("password") } },
  });
  if (r.status === 401) throw kino.error("auth_required", "usuario o contraseña incorrectos");
  if (!r.ok) throw kino.error("unavailable", "el servidor respondió " + r.status);
  const t = r.json().token;
  kino.storage.set(tokenKey(), t);
  return t;
}

// Every request goes through here. A token invalidated server-side (expired, revoked, or a stale one
// from before a real password change) is forgotten and the request tried once more with a fresh login.
// A 429 that asks to wait at most 3 s is waited out once with kino.sleep (the wait counts inside the
// call's own time limit). Every other failure becomes one of Kino's typed errors.
async function api(path, { method = "GET", body, headers = {}, timeoutMs } = {}) {
  const send = async () => reach(path, { method, body, timeoutMs, headers: { ...headers, "X-Token": await token() } });
  let r = await send();
  if (r.status === 401) {
    kino.storage.remove(tokenKey());
    r = await send();
  }
  const wait = Number(r.headers["retry-after"]);
  if (r.status === 429 && wait > 0 && wait <= 3) {
    await kino.sleep(wait * 1000);
    r = await send();
  }
  if (r.status === 401) { kino.storage.remove(tokenKey()); throw kino.error("auth_required", "la sesión venció"); }
  if (r.status === 400 || r.status === 404) throw kino.error("not_found", "el servidor respondió " + r.status);
  if (r.status === 429) throw kino.error("rate_limited");
  // Kino words the other codes itself; this one says more, as "Mensaje de Tu servidor: …" (kino.error's userMessage).
  if (r.status === 451) throw kino.error("geo_blocked", "el servidor respondió 451", { userMessage: "Tu servidor no deja ver este título desde esta red." });
  if (!r.ok) throw kino.error("unavailable", "el servidor respondió " + r.status);
  return r.status === 204 ? null : r.json();
}

// Artwork lives on the same typed server, so `http` and a LAN address are fine here too. Posters
// are 2:3 (the cards), backdrops 16:9 (the info page's background, and each episode's still), the
// logo a clear-logo on a transparent background (meta's `logo`).
const art = (shape, id) => base() + "/img/" + shape + "/" + enc(id) + ".png";
const poster = (id) => art("poster", id);
const backdrop = (id) => art("backdrop", id);

// `kind` comes from the server: "movie", "series" (one season of a show) or "live" (apiVersion 2).
// `ids` only when the server knows them: Kino then matches the title with TMDB and fills in its
// info page (cast, director, tagline...). `adult: true` (apiVersion 6) keeps it behind the person's 18+ code.
const item = (x) => ({
  id: x.id,
  ref: x.id,
  title: x.title,
  kind: x.kind,
  year: x.year,
  poster: poster(x.id),
  backdrop: backdrop(x.id),
  overview: x.overview,
  genres: x.genres ? x.genres.slice(0, 5) : undefined,
  rating: x.rating,
  runtimeMinutes: x.kind === "live" ? undefined : x.runtime,
  badges: x.badges,
  quality: x.quality,
  lang: x.lang,
  ids: x.tmdb || x.imdb ? { tmdb: x.tmdb, imdb: x.imdb } : undefined,
  adult: x.adult || undefined,
});

// A browse ref (a Home or section row, a Categorías tile) as the server's filter: a kind, or "genre:<id>".
function refFilter(ref) {
  if (ref === "movie" || ref === "series" || ref === "live") return "kind=" + ref;
  const genre = /^genre:([a-z0-9-]+)$/.exec(ref);
  return genre ? "genre=" + genre[1] : null;
}

// Home rows, one per kind; each row's ref is the kind, which browse() pages through. `genre` lines the
// rows up with other plugins' in Categorías and the En vivo filter (the live row leaves it to Kino's guess).
const ROWS = [
  { id: "novedades", title: "Novedades", kind: "movie", genre: "peliculas" },
  { id: "series", title: "Series", kind: "series", genre: "series" },
  { id: "en-vivo", title: "En vivo", kind: "live" },
];

// Home asks the server three times; the answer is kept with a storage TTL the person picks ("Revisar lo
// nuevo", a `select` setting), so opening Kino again right away costs no request. An expired entry reads
// as null by itself. A copy without TTL ("home-last:") is the fallback when the server is down.
export async function home() {
  const key = "home:" + scope();
  const cached = kino.storage.get(key);
  if (cached) return JSON.parse(cached);
  let rows;
  try {
    rows = [];
    for (const row of ROWS) {
      const p = await api("/items?limit=10&kind=" + row.kind);
      if (p.items.length) rows.push({ id: row.id, title: row.title, ref: row.kind, genre: row.genre, items: p.items.map(item) });
    }
  } catch (e) {
    const last = kino.storage.get("home-last:" + scope());
    if (!last || !["unavailable", "network", "timeout"].includes(e.code)) throw e;
    kino.log.report("own_server:home", "stale_rows", e.code);
    return JSON.parse(last);
  }
  const minutes = Number(kino.config.get("homeTtl")) || 15;
  kino.storage.set(key, JSON.stringify(rows), { ttlMs: minutes * 60 * 1000 });
  kino.storage.set("home-last:" + scope(), JSON.stringify(rows));
  return rows;
}

export async function browse(ref, cursor) {
  const filter = refFilter(ref);
  if (!filter) throw kino.error("not_found", "fila desconocida");
  const p = await api("/items?limit=10&" + filter + (cursor ? "&cursor=" + enc(cursor) : ""));
  return { items: p.items.map(item), next: p.next || undefined };
}

// The server matches ANY word of the query, so "Serie de prueba" also brings "Video de prueba 1".
// kino.rank turns that into a title search: ask with the title's head, drop the stray-word hits,
// best match first -- trying every form of the title Kino knows. `type` is only a hint: the kind it
// names goes first, nothing is dropped for it. The answer is a Page: its `next` gets "Ver más resultados".
// With `within` (the `scopedSearch` capability) the person is searching inside one of this plugin's
// "Ver más" pages: the server searches that row's kind or genre only; null for a ref it cannot search.
export async function search(query) {
  if (query.within !== undefined) {
    const filter = refFilter(query.within);
    if (!filter) return null;
    const p = await api("/items?limit=50&" + filter + "&q=" + enc(query.q) + (query.cursor ? "&cursor=" + enc(query.cursor) : ""));
    return { items: kino.rank.filterRelevant(p.items, query.q).map(item), next: p.next || undefined };
  }
  if (!query.q.trim()) return [];
  const titles = [query.q, query.originalTitle, ...(query.altTitles || [])].filter(Boolean);
  const p = await api("/items?limit=50&q=" + enc(kino.rank.shortQuery(query.q)) + (query.cursor ? "&cursor=" + enc(query.cursor) : ""));
  const best = kino.rank.sortBySimilarity(kino.rank.filterRelevant(p.items, titles), titles);
  const wanted = query.type === "movie" || query.type === "series" ? query.type : null;
  const ordered = wanted ? [...best.filter((x) => x.kind === wanted), ...best.filter((x) => x.kind !== wanted)] : best;
  return { items: ordered.map(item), next: p.next || undefined };
}

// Each season is its own title on this server, so the answer lists every season of the show in
// `seasons` (the one being answered marked `current`): Kino shows them as chips and calls
// episodes() again with the chosen season's ref.
export async function episodes(ref) {
  const x = await api("/items/" + enc(ref));
  if (x.kind !== "series") throw kino.error("not_found");
  return {
    series: { title: x.show.title, overview: x.show.overview, poster: poster(x.id), backdrop: backdrop(x.id), genres: x.genres, year: x.year },
    episodes: x.episodes.map((e) => ({
      season: x.season, number: e.number, ref: e.id, title: e.title, still: backdrop(e.id),
      overview: e.overview, airDate: e.airDate, runtimeMinutes: e.runtime,
    })),
    seasons: x.seasons.map((s) => ({
      id: s.id,
      ref: s.id,
      title: "Temporada " + s.number,
      number: s.number,
      current: s.id === x.id,
    })),
  };
}

// Movies and episodes are progressive mp4 files, so with `download` declared Kino can save them;
// the live channels are HLS and play as live (never downloadable). A movie with a separate audio
// file gets it as an `audioTracks` entry, merged by the player and picked in its audio menu; its
// subtitles go in `subtitles`; its length in `durationMs` and, when the server knows where THIS file's
// opening and ending are, `skip` ("Saltar intro" / "Saltar outro").
// `options.retry` (apiVersion 6) comes only after the origin refused a signed stream: see signedStream.
export async function resolve(ref, options) {
  // An entry of the list declared with `resolve: true` (liveCategories): its link needs the token.
  if (/\/channels\/[^/]+\/play$/.test(ref)) return resolveListEntry(ref);
  // A lazy copy's own ref ("<title>|<copy>", see below): Kino asks for it only when the person picks that
  // copy in the player's Servidor menu, the fallback reaches it or a download's copy choice does.
  if (ref.includes("|")) return resolveCopy(ref);
  const retry = options && options.retry;
  if (retry) kino.log("resolve: retry", retry.reason, retry.attempt, retry.status || "-");
  const x = await api("/items/" + enc(ref) + (retry ? "?fresh=1" : ""));
  if (x.kind === "live") return { url: base() + x.stream, mime: HLS, headers: agentHeaders() };
  if (x.hls) return signedStream(x);
  const path = x.stream + (kino.config.get("hd") ? "?quality=hd" : "");
  const stream = {
    url: base() + path,
    mime: "video/mp4",
    // The token is short-lived server-side (see server.mjs); resolve again once it's stale.
    expiresInSeconds: 600,
  };
  if (x.durationMs) stream.durationMs = x.durationMs;
  if (x.skip) stream.skip = x.skip;
  if (x.subtitles && x.subtitles.length) {
    stream.subtitles = x.subtitles.map((s) => ({ lang: s.lang, url: base() + s.file, format: s.format }));
  }
  if (x.audio && x.audio.length) {
    stream.audioTracks = x.audio.map((a) => ({ lang: a.lang, label: a.label, url: base() + a.stream }));
  }
  if (x.copies && x.copies.length) return withCopies(ref, stream, x.copies);
  return withAddresses(stream, path);
}

// The same file at the server's other addresses: labelled copies Kino moves to by itself, at the same
// spot, when the main address stops answering mid-film (apiVersion 6 labels, in the player's Servidor menu).
function withAddresses(stream, path) {
  const others = addresses();
  if (!others.length) return stream;
  return {
    ...stream,
    label: "Dirección principal",
    alternatives: others.slice(0, 8).map((a) => ({ label: a.label.slice(0, 48), url: a.url + path, mime: stream.mime })),
  };
}

// Labelled copies (apiVersion 6): the same video on several servers. The Stream carries its own `label`
// and `alternatives`; the player lists them all, by label, in its Servidor menu. A copy whose stream the
// title's answer already has is a plain `{ label, url }`; one that takes another request to find is a
// lazy `{ label, ref }`: Kino calls resolve(ref) for it only when it is needed, so opening the title
// never pays for it. The ref names that one copy ("<title>|<copy>") because it may be resolved minutes
// after the title was.
const copyLabel = (c) => c.lang + " · " + c.name;

function withCopies(ref, stream, copies) {
  const [first, ...rest] = copies;
  return {
    ...stream,
    url: base() + first.stream,
    label: copyLabel(first),
    alternatives: rest.map((c) =>
      c.stream
        ? { label: copyLabel(c), url: base() + c.stream, mime: "video/mp4" }
        : { label: copyLabel(c), ref: ref + "|" + c.id },
    ),
  };
}

// One copy on its own. Its own `alternatives` would be ignored (a copy never expands into more copies).
async function resolveCopy(ref) {
  const [id, copy] = ref.split("|");
  try {
    const c = await api("/items/" + enc(id) + "/copies/" + enc(copy));
    return { url: base() + c.stream, mime: "video/mp4", expiresInSeconds: 600 };
  } catch (e) {
    if (e.code === "not_found") throw kino.error("not_found", "copia " + copy, { userMessage: "Esa copia ya no está en tu servidor; prueba con otra del menú Servidor." });
    throw e;
  }
}

// Signing every request (apiVersion 6): this server wants each playlist and segment request of the
// protected video to carry a signature that is only good for 30 s -- no URL token could last a whole
// film. Kino plays the stream through its local proxy and calls sign() right before every request. What
// sign() needs travels in `signContext` (it runs apart and cannot read kino.storage); the session id goes
// as a plain header. `alternateHosts`: the other addresses of the same server (same scheme), which Kino
// tries when the main one fails. If the server still refuses (409, or 401/403 twice), Kino calls
// resolve(ref, { retry }) and the server is asked for a fresh session (`?fresh=1` above).
function signedStream(x) {
  const scheme = new URL(base()).protocol;
  const hosts = addresses().filter((a) => new URL(a.url).protocol === scheme).map((a) => new URL(a.url).host);
  return {
    url: base() + x.hls,
    mime: HLS,
    headers: { "X-Session": x.session.id },
    signing: "request",
    signContext: JSON.stringify({ key: x.session.key }),
    ...(hosts.length ? { alternateHosts: hosts.slice(0, 6) } : {}),
  };
}

// Headers for ONE request of a signed stream, computed with kino.crypto only (1.5 s; no network, no
// storage). `url` is always the address of the host being asked, so the path signed is the right one.
export async function sign({ url, context }) {
  const { key } = JSON.parse(context);
  const time = String(Math.floor(Date.now() / 1000));
  const path = new URL(url).pathname;
  return { headers: { "X-Time": time, "X-Signature": kino.crypto.hmac("sha256", key, time + ":" + path) } };
}

// Some channels only answer a known player: the person can type the User-Agent Kino presents (Configurar ->
// "User-Agent de los canales"). It goes to the player in all three shapes below -- `headers` on a Stream
// (a `ref` channel's resolve() answer, an inline `stream`) and `streamHeaders` on a playlist -- and to
// nothing else. Left empty, nothing is added and Kino sends its own.
const agentHeaders = () => {
  const agent = String(kino.config.get("userAgent") || "").trim();
  return agent ? { "User-Agent": agent } : undefined;
};

// apiVersion 3's `channels`: Tu servidor's channels in Kino's own En vivo tab (phone tab, TV guide,
// channel drawer), next to -- not instead of -- the "En vivo" Home row above. They show all three
// shapes a plugin can give, mixed in one answer:
//   Noticias  -- channels with a `ref`: Kino sends it to resolve() above when the person plays one
//                (per-channel logic, fresh tokens...); the ref is the item id resolve() already knows;
//   Deportes  -- channels with an inline `stream`: they play with no call to the plugin at all
//                (the fastest zapping), checked by the same rules as resolve()'s answer; their `ref`
//                is only the fallback;
//   playlists -- M3U lists and an XMLTV guide that KINO downloads and parses itself (thousands of
//                channels, no JS): their entries become categories named after their groups. The
//                second one's links need the token, so it says `resolve: true` and each entry plays
//                through resolve(<entry url>).
// Each category and list carries a `genre`, so Kino's En vivo filter lines them up with other providers'.
export async function liveCategories() {
  const categories = await api("/channels/categories");
  const t = await token();
  return [
    ...categories,
    {
      playlist: {
        url: base() + "/lista.m3u",
        format: "m3u",
        // Sent with the list and guide downloads: this server wants its token there too.
        headers: { "X-Token": t },
        // Sent by the PLAYER with every channel of this list (apart from `headers` above: the token goes only to
        // this server's list, never to the hosts the channels are on). An entry that names its own agent wins.
        streamHeaders: agentHeaders(),
        genre: "entretenimiento",
        epg: { url: base() + "/guia.xml.gz", format: "xmltv" },
        refreshHours: 1,
        // Group titles never to show (the "Adultos" group is hidden by Kino whatever you say).
        hideGroups: ["Compras"],
      },
    },
    {
      playlist: {
        url: base() + "/lista-token.m3u",
        format: "m3u",
        headers: { "X-Token": t },
        genre: "entretenimiento",
        refreshHours: 24,
        resolve: true,
      },
    },
  ];
}

// A `resolve: true` list entry: the link is this server's /channels/<id>/play, which answers the stream only
// with the token. Whatever address the list named, it is asked through the typed server.
async function resolveListEntry(ref) {
  const c = await api(new URL(ref).pathname);
  return { url: base() + c.stream, mime: HLS, headers: agentHeaders() };
}

// One channel as Kino takes it: Deportes with an inline stream (and its ref as the fallback), the rest
// with a ref. `categoryId` also marks a liveSearch hit's category.
function channel(c) {
  const out = { id: c.id, title: c.title, number: c.number, categoryId: c.categoryId, logo: poster(c.id), ref: c.id };
  if (c.categoryId === "deportes") out.stream = { url: base() + "/live/" + c.id + ".m3u8", mime: HLS, headers: agentHeaders() };
  return out;
}

// Paged two at a time, the way a big catalog would be: Kino follows `next` (10 pages at first, 5 more as
// the person scrolls).
export async function liveChannels({ categoryId, cursor }) {
  const page = await api("/channels?limit=2&category=" + enc(categoryId) + (cursor ? "&cursor=" + enc(cursor) : ""));
  return { items: page.items.map(channel), next: page.next || null };
}

// En vivo's search, while some channels were never listed (a category not opened yet, a page left).
export async function liveSearch({ query }) {
  const page = await api("/channels/search?q=" + enc(query));
  return { items: page.items.map(channel) };
}

// Optional: a guide for the channels above (the playlist's comes from its XMLTV file). Kino asks for
// at most 50 ids and a window of at most 24 hours, and keeps what falls inside it.
export async function guide({ channelIds, from, to }) {
  return api("/channels/guide?ids=" + enc(channelIds.join(",")) + "&from=" + from + "&to=" + to);
}

// ---------- apiVersion 6: a section of its own, Categorías tiles, moving saved titles, describing titles ----------

// The manifest's `"section": { "label": "Tu servidor" }`: a chip atop Inicio on the phone, an entry in the TV
// sidebar, painted with the manifest's `theme`. One answer per tab; rows are Home rows (same checks).
const TABS = [{ id: "peliculas", label: "Películas" }, { id: "series", label: "Series" }, { id: "en-vivo", label: "En vivo" }];

export async function section({ tab }) {
  const chosen = TABS.some((t) => t.id === tab) ? tab : TABS[0].id;
  const rows = [];
  let hero;
  if (chosen === "peliculas") {
    const movies = (await api("/items?limit=20&kind=movie")).items;
    const featured = movies.find((x) => x.overview && !x.adult);
    if (featured) hero = { title: featured.title, image: backdrop(featured.id), text: featured.overview.slice(0, 300) };
    rows.push({ id: "peliculas-todas", title: "Todas las películas", ref: "movie", genre: "peliculas", items: movies.map(item) });
    for (const g of await api("/genres")) {
      if (g.adult) continue;
      const p = await api("/items?limit=10&kind=movie&genre=" + enc(g.id));
      if (p.items.length) rows.push({ id: "genero-" + g.id, title: g.title, ref: "genre:" + g.id, items: p.items.map(item) });
    }
  } else {
    const kind = chosen === "series" ? "series" : "live";
    const p = await api("/items?limit=20&kind=" + kind);
    rows.push({ id: chosen + "-todo", title: chosen === "series" ? "Todas las series" : "Canales", ref: kind, genre: chosen === "series" ? "series" : undefined, items: p.items.map(item) });
  }
  return { tabs: TABS, tab: chosen, hero, rows };
}

// Tiles of Kino's Categorías (needs `browse`): one per genre of the server, each opening browse("genre:<id>").
// An 18+ genre is marked `adult` and shows only while the person's 18+ code is unlocked.
export async function categories() {
  const genres = await api("/genres");
  return genres.map((g) => ({ id: "genero-" + g.id, title: g.title, ref: "genre:" + g.id, art: backdrop(g.art), adult: g.adult || undefined }));
}

// `migrate`: Kino offers, in the background, every saved value no source can open any more (a library title,
// its chapters, a live favorite or recent). The server keeps the ids it gave its titles before (a library
// rebuilt on a real server changes them): read once and kept an hour, so the many calls cost one request.
// null = not ours, remembered by Kino until this plugin's next version.
async function movedTable() {
  const key = "moved:" + scope();
  const cached = kino.storage.get(key);
  if (cached) return JSON.parse(cached);
  const moved = await api("/moved");
  kino.storage.set(key, JSON.stringify(moved), { ttlMs: 60 * 60 * 1000 });
  return moved;
}

export async function migrate(input) {
  const moved = await movedTable();
  if (input.kind === "title") {
    const t = moved.titles[input.ref];
    return t ? { kind: t.kind, id: t.id, ref: t.id } : null;
  }
  if (input.kind === "chapter") {
    const e = moved.episodes[input.ref];
    return e ? { kind: "episode", ref: e.id, season: e.season, number: e.number } : null;
  }
  if (input.kind === "live") {
    const code = moved.channels[input.code];
    return code ? { kind: "live", code } : null;
  }
  return null;
}

// `meta`: Kino asks it to fill what TMDB left empty on the info page of a title ANY source listed, when the
// server has that title (by its ids). From Kino 0.9.51 also a clear-logo shown instead of the name, other
// sites' ratings next to the page's score, and a cast when TMDB has none. null = not in this library.
export async function meta({ type, ids }) {
  if (!ids.imdb && !ids.tmdb) return null;
  let m;
  try {
    m = await api("/meta?type=" + enc(type) + (ids.imdb ? "&imdb=" + enc(ids.imdb) : "") + (ids.tmdb ? "&tmdb=" + ids.tmdb : ""));
  } catch (e) {
    if (e.code === "not_found") return null;
    throw e;
  }
  return {
    title: m.title,
    overview: m.overview,
    poster: poster(m.id),
    backdrop: backdrop(m.id),
    year: String(m.year),
    genres: m.genres,
    runtimeMinutes: m.runtime,
    logo: art("logo", m.id),
    ratings: m.ratings,
    cast: m.cast.map((c) => ({ name: c.name, character: c.character, photo: poster(c.id) })),
  };
}

// ---------- apiVersion 7 (Kino 0.9.51), and the subtitles any plugin may export ----------

// `subtitles` (declared, so the consent sheet says so): the player's "Buscar subtítulos en línea" for any
// movie or episode Kino knows by id, from any source. Kino 0.9.51 also says which FILE is playing (`file`:
// its OpenSubtitles hash, size and name): the subtitle timed for that exact file goes first, labelled so.
// Then the person's languages in their order; a machine translation is marked `translated`.
export async function subtitles({ imdbId, tmdbId, kind, season, episode, languages, file }) {
  const q = new URLSearchParams();
  if (imdbId) q.set("imdb", imdbId);
  if (tmdbId) q.set("tmdb", String(tmdbId));
  if (kind === "series") { q.set("season", String(season)); q.set("episode", String(episode)); }
  const found = await api("/subtitles?" + q);
  const stem = (name) => String(name || "").toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "");
  const forThisFile = (s) => Boolean(file && ((file.hash && s.hash === file.hash) || (file.name && s.release && stem(s.release) === stem(file.name))));
  const langRank = (s) => { const i = languages.indexOf(s.lang); return i < 0 ? languages.length : i; };
  const rank = (s) => (forThisFile(s) ? 0 : 1000) + langRank(s) * 10 + (s.translated ? 1 : 0);
  return found
    .slice()
    .sort((a, b) => rank(a) - rank(b))
    .map((s) => ({
      lang: s.lang,
      url: base() + s.file,
      format: s.format,
      label: forThisFile(s) ? (s.label + " · para este archivo").slice(0, 60) : s.label,
      translated: s.translated || undefined,
    }));
}

// `tracking` (apiVersion 7, approved in red: "Le contará al servidor que escribas en su configuración qué
// ves y cuándo lo terminas"): Kino calls track() for every movie or episode played on this device, from any
// source, and keeps the event in its own queue until it is delivered (offline, app closed...). The server
// marks what is in its library as watched, like its own app. The event id is the idempotency key. What the
// error codes mean to Kino: `unavailable`/`rate_limited` (and network trouble) retry later, in order;
// `auth_required`/`not_found` drop the event. Log the outcome, never the title.
export async function track(event) {
  const answer = await api("/playing", { method: "POST", body: { json: event }, headers: { "Idempotency-Key": event.id } });
  kino.log("track:", event.type, answer && answer.ignored ? "skipped" : "delivered");
  // A title the server does not have (it played from another source) is of no use to it: dropped, but not
  // counted as a delivery (only a real one clears the red "No pudo avisar…" line in Ajustes).
  return answer && answer.ignored ? { skipped: true } : { ok: true };
}

// `segments` (apiVersion 7): where a title's intro and credits are, for "Saltar intro" / "Saltar outro" on ANY
// movie or episode Kino knows by id, the way an intro-skipper plugin of a media server knows them. Asked in the
// background once the file plays; `durationMs` is that file's length, so the server answers for that cut.
// For an episode `ids` are the episode's own and may be empty: the show's ids + season + episode then.
// (This plugin's own files carry `skip` in their Stream instead, which wins over any segments answer.)
export async function segments({ kind, ids, show, season, episode, durationMs }) {
  const q = new URLSearchParams();
  let known = false;
  if (ids.imdb) { q.set("imdb", ids.imdb); known = true; }
  if (ids.tmdb) { q.set("tmdb", String(ids.tmdb)); known = true; }
  if (kind === "episode" && show) {
    if (show.ids.imdb) { q.set("showImdb", show.ids.imdb); known = true; }
    if (show.ids.tmdb) { q.set("showTmdb", String(show.ids.tmdb)); known = true; }
    q.set("season", String(season));
    q.set("episode", String(episode));
  }
  if (!known) return null;
  if (durationMs) q.set("duration", String(durationMs));
  const found = await api("/segments?" + q);
  return found.map((s) => ({ type: s.type, startMs: Math.round(s.startMs), endMs: Math.round(s.endMs) }));
}

// ---------- the settings form (apiVersion 6): status lines, buttons, and a check before saving ----------

const EVENT_WORDS = { start: "empezaste a verlo", progress: "lo estás viendo", stop: "lo dejaste", watched: "visto" };

// Why a call failed, in words for a status line (the form shows it as is).
function failure(e) {
  if (e.code === "auth_required") return "Tu servidor no acepta ese usuario y contraseña";
  if (e.code === "timeout" || e.code === "network") return "Tu servidor no responde en esa dirección";
  if (e.code === "host_not_allowed") return "Guarda la dirección para poder probarla";
  return "Tu servidor respondió con un error";
}

// One text per `status` setting, asked when the form opens and after every button. It runs even while a
// required setting is still empty, so it says what is missing.
export async function settingsStatus() {
  if (!kino.config.get("server")) return { estado: "Escribe la dirección de tu servidor", ultimoAviso: "Sin información" };
  if (!kino.config.get("user") || !kino.config.get("password")) return { estado: "Escribe tu usuario y contraseña", ultimoAviso: "Sin información" };
  try {
    const s = await api("/status", { timeoutMs: 8000 });
    const p = await api("/playing", { timeoutMs: 8000 });
    return {
      estado: `Conectado a ${s.name} ${s.version} como ${s.user}: ${s.titles} títulos`,
      ultimoAviso: p.last ? `${p.last.title}: ${EVENT_WORDS[p.last.type] || p.last.type} (${p.count === 1 ? "1 aviso" : p.count + " avisos"} en total)` : "Tu servidor aún no ha recibido avisos",
    };
  } catch (e) {
    return { estado: failure(e), ultimoAviso: "Sin información" };
  }
}

// The form's buttons. "Cerrar sesión" also forgets this account's cached answers and the cookie jar;
// "Usar el User-Agent de Kino" empties an optional setting through `clearSettings`, as if the person had
// emptied the field and saved.
export async function action(key) {
  if (key === "probar") {
    const started = Date.now();
    const s = await api("/status", { timeoutMs: 8000 });
    return { message: `${s.name} respondió en ${Date.now() - started} ms (versión ${s.version}).` };
  }
  if (key === "salir") {
    try {
      await api("/session", { method: "DELETE" });
    } catch (e) {
      if (e.code !== "auth_required") throw e;
    }
    const mine = ":" + scope();
    for (const k of kino.storage.keys()) if (k.endsWith(mine)) kino.storage.remove(k);
    kino.cookies.clear();
    return { message: "Sesión cerrada. La próxima vez Kino vuelve a entrar con tu usuario y contraseña." };
  }
  if (key === "quitarAgente") return { message: "Listo: los canales usan otra vez el User-Agent de Kino.", clearSettings: ["userAgent"] };
  return null;
}

// Checked BEFORE Kino saves. Formats first, offline; then, when the server is the one already saved (a new
// address becomes reachable only once saved), the account against it: a wrong password never gets saved.
// `values` has only the valued settings, trimmed; kino.config.all() is what is saved now.
export async function validateSettings(values) {
  const errors = {};
  const server = trimSlash(values.server || "");
  try {
    const u = new URL(server);
    if ((u.pathname !== "/" && u.pathname !== "") || u.search) errors.server = "Escribe solo la dirección, sin rutas: por ejemplo http://192.168.1.10:8096";
  } catch {
    errors.server = "Esa no es una dirección completa: empieza por http:// o https://";
  }
  if (/\s/.test(String(values.user || ""))) errors.user = "El usuario no lleva espacios";
  if (/[\r\n]/.test(String(values.userAgent || ""))) errors.userAgent = "El User-Agent va en una sola línea";
  const others = Array.isArray(values.addresses) ? values.addresses : [];
  if (others.some((a) => trimSlash(a.url) === server)) errors.addresses = "Esa dirección ya es la del servidor de arriba";
  if (Object.keys(errors).length) return errors;

  const saved = kino.config.all();
  if (saved.server && trimSlash(saved.server) === server && values.user && values.password) {
    try {
      const r = await kino.fetch(server + "/auth", { method: "POST", body: { json: { user: values.user, password: values.password } }, timeoutMs: 8000 });
      if (r.status === 401) return { password: "Tu servidor no reconoce ese usuario con esa contraseña" };
    } catch (e) {
      kino.log("validateSettings: account not checked:", e.code);
    }
  }
  return null;
}
