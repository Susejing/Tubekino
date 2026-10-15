// Offline tests: every answer comes from test/fixtures.json, a recording of real exchanges with
// server.mjs (README.md, "Develop and test"), so no server needs to be running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validate } from "../sdk/validate.mjs";
import { loadPlaylist } from "../sdk/live-playlist.mjs";
import { checkOutput, checkSettingsOutput, segmentSkip, validateManifest } from "../sdk/contract.mjs";
import { createKino, signingLane } from "../sdk/kino-shim.mjs";
import { artwork, logo } from "../artwork.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures.json");
const skip = !existsSync(fixtures) && "record test/fixtures.json first";
const manifest = validateManifest(readFileSync(join(root, "kino-plugin.json"), "utf8")).manifest;

// The same server/user/password used when the fixtures were recorded: they decide the URLs and
// cache keys the plugin builds, which the replay looks up by exact match.
const config = { server: "http://192.168.1.10:8096", user: "ana", password: "s3cr3t" };
const server = config.server;

// The playlists are downloaded by Kino itself, not through kino.fetch: the tests' own fetch answers
// them from the same recording, and only with the token the plugin put in their headers.
const tape = skip ? [] : JSON.parse(readFileSync(fixtures, "utf8"));
async function fetchImpl(url, init = {}) {
  const taped = tape.find((t) => t.key === JSON.stringify(["GET", String(url), null]));
  const token = JSON.parse(Buffer.from(tape[0].body, "base64")).token;
  if (!taped) return new Response("not recorded", { status: 404 });
  if (init.headers["X-Token"] !== token) return new Response("no token", { status: 401 });
  return new Response(Buffer.from(taped.body, "base64"), { status: taped.status });
}

// `live guide` asks for a window starting two hours before now; the guide was recorded with the
// clock at this instant, so the replayed request matches it.
const RECORDED_AT = 1790575200000;

async function pinned(fn) {
  const now = Date.now;
  Date.now = () => RECORDED_AT;
  try {
    return await fn();
  } finally {
    Date.now = now;
  }
}

// One export through the kit, exactly as `node sdk/validate.mjs . --run <fn> <args>` runs it.
async function run(fn, ...args) {
  const r = await pinned(() => validate(root, { run: fn, args, config, replay: fixtures, fetchImpl }));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.drops, []);
  return r.output;
}

// The plugin itself, for what the kit's validate does not run (section, categories, meta, the settings
// form, sign, errors): a fresh `kino` (storage included) over the same recording for every call.
const copy = join(mkdtempSync(join(tmpdir(), "own-server-test-")), "plugin.mjs");
writeFileSync(copy, readFileSync(join(root, "plugin.js")));
const plugin = await import(pathToFileURL(copy).href);
function kinoFor(cfg = config) {
  const k = createKino(manifest, { config: cfg, replay: fixtures });
  globalThis.kino = k.kino;
  return k;
}
async function direct(fn, ...args) {
  kinoFor();
  return pinned(() => plugin[fn](...args));
}
async function failing(fn, ...args) {
  try {
    await direct(fn, ...args);
  } catch (e) {
    return e;
  }
  assert.fail(fn + " did not fail");
}

// ---------- the manifest ----------

test("Kino accepts the manifest and the exports", async () => {
  const r = await validate(root);
  assert.deepEqual(r.problems, []);
});

test("the manifest is apiVersion 7, declares no host of its own and asks for each power on the consent sheet", async () => {
  assert.equal(manifest.apiVersion, 7);
  assert.deepEqual(manifest.hosts, []);
  assert.equal(manifest.liveStreamHostsAny, false);
  for (const c of ["download", "channels", "scopedSearch", "migrate", "meta", "subtitles", "tracking", "segments"]) assert.ok(manifest.capabilities.includes(c), c);
  const r = await validate(root);
  const lines = r.consent.map((c) => [c.text, !!c.danger]);
  assert.deepEqual(lines, [
    ["Este plugin usa tu usuario y contraseña", false],
    ["Se conectará a los servidores que escribas en su configuración", false],
    ["Puede descargar videos para verlos sin conexión", false],
    ["Agrega canales en vivo a la pestaña En vivo", false],
    ["Revisar lo que tienes guardado (biblioteca, historial, favoritos) para pasarlo a este plugin", false],
    ["Agrega subtítulos a tus películas y series", false],
    ["Le contará al servidor que escribas en su configuración qué ves y cuándo lo terminas", true],
    ["Agrega el botón para saltar la intro y los créditos", false],
    ["Comparte registros de errores con Kino para corregir fallas", false],
  ]);
});

test("the settings form: 7 valued settings and 9 that only show or do something, a section hint past 80 characters", () => {
  const valued = manifest.settings.filter((s) => !["section", "status", "action"].includes(s.type));
  assert.deepEqual(valued.map((s) => [s.key, s.type]), [
    ["server", "url"], ["user", "text"], ["password", "password"], ["hd", "toggle"], ["homeTtl", "select"], ["addresses", "list"], ["userAgent", "text"],
  ]);
  assert.equal(manifest.settings.length - valued.length, 9);
  assert.ok(manifest.settings.find((s) => s.key === "cuenta").hint.length > 80, "Kino 0.9.51 takes a section hint up to 300 characters");
});

// ---------- search, Home, browse, episodes ----------

test("a one-word search keeps every hit that has the word, the 18+ one marked", { skip }, async () => {
  const out = await run("search", "prueba");
  assert.deepEqual(out.items.map((x) => x.id), ["v1", "adulto", "serie-t1", "serie-t2"]);
  assert.equal(out.items.find((x) => x.id === "adulto").adult, true);
});

test("a full title drops what only shares a stray word with it", { skip }, async () => {
  // The server answers "Serie de prueba" with several hits (any shared word); the rest are near-misses.
  const out = await run("search", "Serie de prueba");
  assert.deepEqual(out.items.map((x) => x.id), ["serie-t1", "serie-t2"]);
});

test("a search inside a Ver más page asks the server for that row only, and null for a ref it does not know", { skip }, async () => {
  assert.deepEqual((await direct("search", { q: "doblaje", type: "any", within: "movie", cursor: null })).items.map((x) => x.id), ["doblaje"]);
  assert.deepEqual((await direct("search", { q: "bunny", type: "any", within: "genre:animacion", cursor: null })).items.map((x) => x.id), ["bbb"]);
  assert.equal(await direct("search", { q: "bunny", type: "any", within: "otra-cosa", cursor: null }), null);
});

test("home: movies (one with ids, one 18+), series and the live channels, each row with its genre", { skip }, async () => {
  const rows = await run("home");
  assert.deepEqual(rows.map((r) => [r.id, r.genre]), [["novedades", "peliculas"], ["series", "series"], ["en-vivo", null]]);
  const bbb = rows[0].items.find((x) => x.id === "bbb");
  assert.deepEqual([bbb.tmdb, bbb.imdb, bbb.rating, bbb.runtimeMinutes], [10378, "tt1254207", 6.4, 10]);
  assert.equal(rows[0].items.find((x) => x.id === "adulto").adult, true);
  assert.deepEqual(rows[1].items.map((x) => x.kind), ["series", "series"]);
  assert.deepEqual(rows[2].items.map((x) => [x.id, x.kind]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [`canal-${n}`, "live"]));
});

test("every card points at its own poster and backdrop on the typed server", { skip }, async () => {
  const rows = await run("home");
  const bbb = rows[0].items.find((x) => x.id === "bbb");
  assert.equal(bbb.poster, server + "/img/poster/bbb.png");
  assert.equal(bbb.backdrop, server + "/img/backdrop/bbb.png");
});

test("browse pages a genre (a Categorías tile's ref)", { skip }, async () => {
  assert.deepEqual((await run("browse", "genre:animacion")).items.map((x) => x.id), ["bbb"]);
});

// The PNG's width and height, straight from its IHDR chunk.
const size = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];

test("artwork: a 2:3 poster, a 16:9 backdrop and a transparent clear-logo, the same bytes every time, different per title", () => {
  const a = artwork({ id: "doblaje", title: "Película con doblaje", label: "Pelicula", shape: "poster" });
  assert.deepEqual([...a.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(""), "PNG");
  assert.deepEqual(size(a), [300, 450]);
  const b = artwork({ id: "serie-t1-e3", title: "El final de temporada", label: "T1 - Episodio 3", shape: "backdrop" });
  assert.deepEqual(size(b), [480, 270]);
  assert.ok(a.equals(artwork({ id: "doblaje", title: "Película con doblaje", label: "Pelicula", shape: "poster" })));
  assert.ok(!a.equals(artwork({ id: "bbb", title: "Big Buck Bunny", label: "Pelicula", shape: "poster" })));
  const l = logo({ id: "bbb", title: "Big Buck Bunny" });
  assert.deepEqual(size(l), [600, 150]);
  assert.equal(l[25], 6, "RGBA: the logo's background is transparent");
});

test("episodes lists the season's episodes and every season of the show", { skip }, async () => {
  const out = await run("episodes", "serie-t1");
  assert.deepEqual(out.episodes.map((e) => [e.season, e.number, e.ref, e.airDate]), [[1, 1, "serie-t1-e1", "2025-01-01"], [1, 2, "serie-t1-e2", "2025-01-02"], [1, 3, "serie-t1-e3", "2025-01-03"]]);
  assert.deepEqual(out.seasons.map((s) => [s.id, s.number, s.current]), [["serie-t1", 1, true], ["serie-t2", 2, false]]);
});

// ---------- resolve ----------

test("a movie with a separate audio file, its own subtitle and its own intro/credits marks", { skip }, async () => {
  const s = await run("resolve", "doblaje");
  assert.equal(s.url, server + "/stream/doblaje");
  assert.equal(s.mime, "video/mp4");
  assert.deepEqual(s.audioTracks, [{ lang: "es-419", label: "Español (doblaje de prueba)", url: server + "/stream/audio-es" }]);
  assert.deepEqual(s.subtitles, [{ lang: "es", url: server + "/subs/doblaje.es.vtt", format: "vtt" }]);
  assert.equal(s.durationMs, 45000);
  assert.deepEqual(s.skip, { openingStartMs: 1000, openingEndMs: 8000, endingStartMs: 37000 });
});

test("a movie with copies resolves with labelled copies, one of them lazy (apiVersion 6)", { skip }, async () => {
  const s = await run("resolve", "copias");
  assert.equal(s.label, "Latino · Servidor A");
  assert.equal(s.url, server + "/stream/v1");
  assert.equal(s.alternatives.length, 2);
  assert.deepEqual([s.alternatives[0].label, s.alternatives[0].url], ["Original · Servidor B", server + "/stream/doblaje"]);
  // The third copy is not resolved with the title: it carries a ref and no url.
  assert.deepEqual([s.alternatives[1].label, s.alternatives[1].ref, s.alternatives[1].url], ["Subtitulado · Servidor C", "copias|c", undefined]);
});

test("a lazy copy's ref resolves through resolve(ref) to just that copy; a gone one says so in the plugin's words", { skip }, async () => {
  const s = await run("resolve", "copias|c");
  assert.equal(s.url, server + "/stream/doblaje");
  assert.equal(s.alternatives, undefined);
  const e = await failing("resolve", "copias|z");
  assert.equal(e.code, "not_found");
  assert.equal(e.userMessage, "Esa copia ya no está en tu servidor; prueba con otra del menú Servidor.");
});

test("the other addresses of the same server become labelled copies of every file", { skip }, async () => {
  const k = kinoFor({ ...config, addresses: [{ url: "https://casa.example.org/", label: "" }, { url: "http://192.168.1.11:8096", label: "Otra red" }] });
  const s = checkOutput("resolve", await plugin.resolve("bbb"), manifest, k.servers).value;
  assert.equal(s.label, "Dirección principal");
  // Unnamed, an address is labelled with its host.
  assert.deepEqual(s.alternatives.map((a) => [a.label, a.url]), [["casa.example.org", "https://casa.example.org/stream/doblaje"], ["Otra red", "http://192.168.1.11:8096/stream/doblaje"]]);
});

test("typed errors: rate_limited after waiting out one Retry-After, geo_blocked with the plugin's own sentence", { skip }, async () => {
  assert.equal((await failing("resolve", "err-404")).code, "not_found");
  assert.equal((await failing("resolve", "err-429")).code, "rate_limited");
  const geo = await failing("resolve", "err-451");
  assert.deepEqual([geo.code, geo.userMessage], ["geo_blocked", "Tu servidor no deja ver este título desde esta red."]);
  assert.equal((await failing("resolve", "err-503")).code, "unavailable");
});

test("the protected video is signed per request: sign() computes the server's HMAC, a retry asks for a fresh session", { skip }, async () => {
  const s = await run("resolve", "protegido");
  assert.equal(s.signing, true);
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
  assert.ok(s.headers["X-Session"]);
  const { key } = JSON.parse(s.signContext);
  // sign() runs in its own lane in the app: no network, no storage.
  const k = kinoFor();
  globalThis.kino = signingLane(k.kino);
  const url = server + "/secure/protegido/1.ts";
  const { headers } = await plugin.sign({ url, kind: "segment", ref: "protegido", context: s.signContext });
  const want = createHmac("sha256", key).update(`${headers["X-Time"]}:/secure/protegido/1.ts`).digest("hex");
  assert.equal(headers["X-Signature"], want);
  kinoFor();
  const again = await plugin.resolve("protegido", { retry: { reason: "expired", attempt: 1, status: 403 } });
  assert.notEqual(again.headers["X-Session"], s.headers["X-Session"]);
});

// ---------- channels ----------

// The person's "User-Agent de los canales" setting reaches the player in the three shapes of a live channel.
const withAgent = { ...config, userAgent: "VLC/3.0.20 LibVLC/3.0.20" };
async function runWithAgent(fn, ...args) {
  const r = await pinned(() => validate(root, { run: fn, args, config: withAgent, replay: fixtures, fetchImpl }));
  assert.deepEqual(r.problems, []);
  return r.output;
}

test("with a User-Agent set, a ref channel, an inline stream and a playlist all carry it", { skip }, async () => {
  const agent = { "User-Agent": "VLC/3.0.20 LibVLC/3.0.20" };
  assert.deepEqual((await runWithAgent("resolve", "canal-1")).headers, agent);
  const sports = await runWithAgent("liveChannels", "deportes");
  assert.deepEqual(sports.items.map((c) => c.stream.headers), [agent, agent]);
  const playlist = (await runWithAgent("liveCategories")).playlists[0];
  assert.deepEqual(playlist.streamHeaders, agent);
  assert.ok(playlist.headers["X-Token"], "the list's own token stays in headers, for its download");
  assert.equal(playlist.streamHeaders["X-Token"], undefined, "and never goes to the channels' hosts");
});

test("with no User-Agent set, nothing is added", { skip }, async () => {
  assert.deepEqual((await run("resolve", "canal-1")).headers, {});
  assert.deepEqual((await run("liveCategories")).playlists[0].streamHeaders, {});
  assert.deepEqual((await run("liveChannels", "deportes")).items.map((c) => c.stream.headers), [{}, {}]);
});

test("a live channel resolves to an HLS playlist", { skip }, async () => {
  const s = await run("resolve", "canal-1");
  assert.equal(s.url, server + "/live/canal-1.m3u8");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
});

test("channels: ref channels, inline-stream channels with a ref fallback, paged two at a time; two playlists", { skip }, async () => {
  const cats = await run("liveCategories");
  assert.deepEqual(cats.categories.map((c) => [c.id, c.genre]), [["noticias", "noticias"], ["deportes", "deportes"]]);
  assert.deepEqual(cats.playlists.map((p) => [p.url, p.epgUrl, p.hideGroups, p.resolve, p.genre]), [
    [server + "/lista.m3u", server + "/guia.xml.gz", ["compras"], false, "entretenimiento"],
    [server + "/lista-token.m3u", "", [], true, "entretenimiento"],
  ]);
  const news = await run("liveChannels", "noticias");
  assert.deepEqual(news.items.map((c) => [c.id, c.number, c.ref, c.stream === null]), [["canal-1", 1, "canal-1", true], ["canal-2", 2, "canal-2", true]]);
  assert.equal(news.next, "2");
  assert.deepEqual((await run("liveChannels", "noticias", "2")).items.map((c) => c.id), ["canal-3"]);
  const sports = await run("liveChannels", "deportes");
  assert.deepEqual(sports.items.map((c) => [c.ref, c.stream && c.stream.url]), [4, 5].map((n) => [`canal-${n}`, server + `/live/canal-${n}.m3u8`]));
  const stream = await run("resolve", news.items[0].ref);
  assert.ok(stream.url.startsWith(server + "/live/canal-1.m3u8"));
});

test("channels: the first playlist shows its three channels, Compras and Adultos hidden; the second plays through resolve()", { skip }, async () => {
  const cats = await run("liveCategories");
  const s = await loadPlaylist(cats.playlists[0], { manifest, servers: [server], fetchImpl });
  assert.equal(s.channels, 3);
  assert.equal(s.hidden, 2);
  assert.equal(s.skipped, 0);
  assert.deepEqual(s.categories.map((c) => [c.title, c.count]), [["Lista de prueba", 3]]);
  assert.deepEqual(s.entries.map((e) => [e.tvgId, e.url]), [7, 8, 9].map((n) => [`lista-${n}`, server + `/live/canal-${n}.m3u8`]));
  const t = await loadPlaylist(cats.playlists[1], { manifest, servers: [server], fetchImpl });
  assert.deepEqual(t.entries.map((e) => [e.tvgId, e.url]), [["lista-10", server + "/channels/canal-10/play"]]);
  const played = await run("resolve", server + "/channels/canal-10/play");
  assert.equal(played.url, server + "/live/canal-10.m3u8");
});

test("channels: En vivo's search finds unlisted channels, each marked with its category", { skip }, async () => {
  const hits = await run("liveSearch", "depor");
  assert.deepEqual(hits.items.map((c) => [c.id, c.categoryId]), [["canal-4", "deportes"], ["canal-5", "deportes"], ["canal-6", "deportes"]]);
});

test("channels: a small guide for the ref and inline-stream channels", { skip }, async () => {
  const g = await run("guide", "canal-1,canal-4");
  assert.deepEqual([...new Set(g.map((e) => e.channelId))].sort(), ["canal-1", "canal-4"]);
  assert.ok(g.every((e) => e.end > e.start));
  assert.deepEqual([...new Set(g.filter((e) => e.channelId === "canal-4").map((e) => e.title))].sort(), ["Análisis", "Fútbol en vivo", "Goles de la fecha"]);
});

// ---------- apiVersion 6: section, categories, migrate, meta ----------

test("section: three tabs, a hero on Películas and a row per genre, the 18+ genre left out", { skip }, async () => {
  const first = checkOutput("section", await direct("section", { tab: null }), manifest, [server]).value;
  assert.deepEqual(first.tabs.map((t) => t.id), ["peliculas", "series", "en-vivo"]);
  assert.equal(first.tab, "peliculas");
  assert.equal(first.hero.title, "Video de prueba 1");
  assert.deepEqual(first.rows.map((r) => [r.id, r.ref]), [["peliculas-todas", "movie"], ["genero-pruebas", "genre:pruebas"], ["genero-animacion", "genre:animacion"]]);
  const series = checkOutput("section", await direct("section", { tab: "series" }), manifest, [server]).value;
  assert.deepEqual(series.rows.map((r) => r.items.length), [2]);
});

test("categories: one tile per genre, the 18+ one marked", { skip }, async () => {
  const tiles = checkOutput("categories", await direct("categories", null), manifest, [server]).value;
  assert.deepEqual(tiles.map((t) => [t.id, t.ref, !!t.adult]), [
    ["genero-pruebas", "genre:pruebas", false], ["genero-animacion", "genre:animacion", false], ["genero-drama", "genre:drama", false], ["genero-adultos", "genre:adultos", true],
  ]);
});

test("migrate: titles, chapters and live favorites the server knew by older ids; null for the rest", { skip }, async () => {
  assert.deepEqual(await run("migrate", JSON.stringify({ kind: "title", ref: "big-buck-bunny-2008" })), { kind: "movie", id: "bbb", ref: "bbb" });
  assert.deepEqual(await direct("migrate", { kind: "title", ref: "serie-de-prueba-t1" }), { kind: "series", id: "serie-t1", ref: "serie-t1" });
  assert.deepEqual(await direct("migrate", { kind: "chapter", ref: "serie-de-prueba-1x2", season: 1, episode: 2 }), { kind: "episode", ref: "serie-t1-e2", season: 1, number: 2 });
  assert.deepEqual(await direct("migrate", { kind: "live", provider: "otro", code: "noticias-uno" }), { kind: "live", code: "canal-1" });
  assert.equal(await direct("migrate", { kind: "title", ref: "otra-cosa" }), null);
});

test("meta: a title of the library, by its ids, with a clear-logo, two ratings and its cast; null for others", { skip }, async () => {
  const m = await direct("meta", { type: "movie", ids: { imdb: "tt1254207", tmdb: 10378 }, lang: "es" });
  assert.equal(m.logo, server + "/img/logo/bbb.png");
  assert.deepEqual(m.ratings, [{ source: "imdb", value: "6.4" }, { source: "letterboxd", value: "3.4/5" }]);
  assert.deepEqual(m.cast.map((c) => [c.name, c.photo]), [["Ana Prueba", server + "/img/poster/ana-prueba.png"], ["Luis Ensayo", server + "/img/poster/luis-ensayo.png"]]);
  assert.equal(await direct("meta", { type: "movie", ids: { tmdb: 603 }, lang: "es" }), null);
  assert.equal(await direct("meta", { type: "series", ids: { kitsu: 1 } }), null);
});

// ---------- apiVersion 7 and subtitles ----------

test("subtitles: the person's languages first, the machine translation marked; none for a title not in the library", { skip }, async () => {
  const tracks = await direct("subtitles", { imdbId: "tt1254207", kind: "movie", languages: ["en", "es"] });
  assert.deepEqual(tracks.map((t) => [t.lang, t.translated]), [["en", undefined], ["es", undefined], ["pt", true]]);
  assert.deepEqual(await run("subtitles", "tt0133093"), []);
});

test("subtitles: Kino 0.9.51's file hint puts the subtitle timed for that file first, by hash or by name", { skip }, async () => {
  const hashOfServedFile = "79281c506b7369f0"; // media/doblaje.mp4, which Big Buck Bunny streams
  const byHash = await direct("subtitles", { imdbId: "tt1254207", kind: "movie", languages: ["en", "es"], file: { hash: hashOfServedFile, size: 1 } });
  assert.deepEqual([byHash[0].lang, byHash[0].label], ["es", "Big.Buck.Bunny.2008.1080p · para este archivo"]);
  const byName = await direct("subtitles", { tmdbId: 10378, kind: "movie", languages: ["es", "en"], file: { name: "Big.Buck.Bunny.2008.720p.mkv" } });
  assert.deepEqual([byName[0].lang, byName[0].label], ["en", "Big.Buck.Bunny.2008.720p · para este archivo"]);
});

test("tracking: a title of the library is delivered; one from elsewhere is skipped, never an error", { skip }, async () => {
  const watched = { id: "evt-bbb-watched", at: RECORDED_AT, ids: { imdb: "tt1254207", tmdb: 10378 }, title: "Big Buck Bunny", year: 2008, positionMs: 44000, durationMs: 45000, progress: 0.98 };
  assert.deepEqual(await run("track", "watched", JSON.stringify(watched)), { ok: true });
  assert.deepEqual(await run("track", "start", JSON.stringify({ id: "evt-matrix-start", at: RECORDED_AT })), { skipped: true });
});

test("segments: intro and credits for the same cut, nothing for another cut or a title the server lacks", { skip }, async () => {
  const s = await run("segments", "tt1254207", "45000");
  assert.deepEqual(s, [{ type: "intro", startMs: 2000, endMs: 9000 }, { type: "credits", startMs: 38000, endMs: 45000 }]);
  assert.deepEqual(segmentSkip(s), { openingStartMs: 2000, openingEndMs: 9000, endingStartMs: 38000 });
  assert.deepEqual(await run("segments", "tt1254207", "60000"), []);
  assert.deepEqual(await run("segments", "tmdb:1396", "1", "2", "2880000"), []);
  assert.equal(await direct("segments", { kind: "movie", ids: {} }), null);
});

// ---------- the settings form ----------

const settings = (fn, value) => checkSettingsOutput(fn, value, manifest);

test("settingsStatus: who is connected, and the last thing the server was told", { skip }, async () => {
  assert.deepEqual(settings("settingsStatus", await direct("settingsStatus")), {
    estado: "Conectado a Tu servidor (referencia) 1.5.0 como ana: 22 títulos",
    ultimoAviso: "Big Buck Bunny: visto (1 aviso en total)",
  });
  kinoFor({ server });
  assert.equal((await plugin.settingsStatus()).estado, "Escribe tu usuario y contraseña");
});

test("the buttons: probar answers with the server's version, quitarAgente clears a setting, salir forgets the session", { skip }, async () => {
  assert.match((await direct("action", "probar")).message, /^Tu servidor \(referencia\) respondió en \d+ ms \(versión 1\.5\.0\)\.$/);
  assert.deepEqual(settings("action", await direct("action", "quitarAgente")).clearSettings, ["userAgent"]);
  const k = kinoFor();
  await plugin.home();
  assert.ok(k.kino.storage.keys().some((key) => key.startsWith("home:")));
  await plugin.action("salir");
  assert.deepEqual(k.kino.storage.keys(), ["client-id"], "only the install's id survives");
});

test("validateSettings: formats first, then the account against the saved server", { skip }, async () => {
  assert.deepEqual(await direct("validateSettings", { server, user: "ana", password: "mala" }), { password: "Tu servidor no reconoce ese usuario con esa contraseña" });
  assert.equal(await direct("validateSettings", { server, user: "ana", password: "s3cr3t" }), null);
  assert.deepEqual(Object.keys(await direct("validateSettings", { server: server + "/web/index.html", user: "ana maria", password: "x" })), ["server", "user"]);
  assert.deepEqual(await direct("validateSettings", { server, user: "ana", password: "x", addresses: [{ url: server + "/" }] }), { addresses: "Esa dirección ya es la del servidor de arriba" });
  // A new address is not reachable until it is saved: accepted without a check.
  assert.equal(await direct("validateSettings", { server: "http://192.168.1.20:8096", user: "ana", password: "x" }), null);
});
