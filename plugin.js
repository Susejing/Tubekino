// TubeKino 0.3.3 — YouTube en Kino: búsqueda, listas, canales y reproducción.
//
// Cómo funciona: YouTube no entrega los enlaces de video así nada más.
// Este plugin usa la misma API interna que las apps oficiales de YouTube
// (Innertube) para buscar y para pedir los formatos directamente, y cuando
// YouTube los bloquea (cada vez le exige más "tokens" a los clientes no
// oficiales), abre la página real del video en el navegador oculto de Kino:
// el reproductor de verdad calcula lo que haga falta y el plugin captura el
// enlace que genera, con sus encabezados. Directo es rápido; el navegador
// oculto es la red de seguridad.
//
// En el buscador de Kino también puedes pegar un enlace de YouTube
// (youtu.be/..., youtube.com/watch?v=..., /shorts/..., /live/...) y se abre
// directo.

const VERSION = "0.3.3";

// Diagnóstico: qué sirvió cada vía en el último video (se ve en Ajustes).
let ultimoDirecto = null;
let ultimoNavegador = null;
let ultimoResolve = null;

// Diagnóstico de la portada: cuántas filas se pudieron armar (en Estado y en
// el informe "debug").
let trazaTendencias = "";

// Diagnóstico de reproducción: por dónde y en qué calidad salió el video.
let trazaDirecto = "";

// Diagnóstico cliente por cliente: qué le respondió YouTube a cada uno en el
// último video (se ve con "debug"). Cada entrada es una línea.
let trazaClientes = [];

// ---------- Innertube: los clientes que se presentan como apps oficiales ----------

const KEY_ANDROID = "AIzaSyA8eiZmM1FaDVjRyDfZTLQEjFIgb6DAlf0";
const KEY_IOS = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc";
const KEY_WEB = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

// País de tendencias y resultados (se configura en Ajustes).
function paisActual() {
  const p = String(kino.config.get("pais") || "CO").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(p) ? p : "CO";
}

function ctxAndroid() {
  return {
    key: KEY_ANDROID,
    num: "3",
    etiqueta: "ANDROID",
    client: {
      clientName: "ANDROID",
      clientVersion: "21.26.364",
      androidSdkVersion: 30,
      osName: "Android",
      osVersion: "11",
      hl: "es-419",
      gl: paisActual(),
      userAgent: "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip"
    }
  };
}

// ANDROID sin el número de SDK: presentar el SDK activa la exigencia de
// tokens de YouTube; sin él, muchos videos llegan con enlaces completos.
// (Truco documentado por yt-dlp y librerías similares.)
function ctxAndroidSdkless() {
  return {
    key: KEY_ANDROID,
    num: "3",
    etiqueta: "ANDROID_SDKLESS",
    client: {
      clientName: "ANDROID",
      clientVersion: "21.26.364",
      osName: "Android",
      osVersion: "11",
      hl: "es-419",
      gl: paisActual(),
      userAgent: "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip"
    }
  };
}

function ctxIos() {
  return {
    key: KEY_IOS,
    num: "5",
    etiqueta: "IOS",
    client: {
      clientName: "IOS",
      clientVersion: "21.26.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
      hl: "es-419",
      gl: paisActual(),
      userAgent: "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"
    }
  };
}

// Cliente WEB: es el que responde las tendencias sin pedir tokens.
function ctxWeb() {
  return {
    key: KEY_WEB,
    num: "1",
    client: {
      clientName: "WEB",
      clientVersion: "2.20250210.05.00",
      hl: "es-419",
      gl: paisActual(),
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"
    }
  };
}

// Cliente ANDROID_VR (la app de YouTube en visores): es de los pocos a los que
// YouTube NO exige "PO tokens", así que entrega la lista completa de formatos
// con enlaces incluidos, hasta 1080p y más (falla en videos "para niños").
// Versión y datos exactos que usa yt-dlp hoy.
function ctxVr() {
  return {
    key: KEY_ANDROID,
    num: "28",
    etiqueta: "ANDROID_VR",
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.65.10",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
      hl: "es-419",
      gl: paisActual(),
      userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
    }
  };
}

// Cliente WEB con navegador Safari: YouTube le entrega un manifiesto HLS
// (m3u8) con varias calidades que, por ahora, NO exige tokens. Es la vía de
// calidad alta cuando la app VR falla.
function ctxWebSafari() {
  return {
    key: KEY_WEB,
    num: "1",
    etiqueta: "WEB_SAFARI",
    client: {
      clientName: "WEB",
      clientVersion: "2.20260708.00.00",
      hl: "es-419",
      gl: paisActual(),
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)"
    }
  };
}

// Cliente WEB de videos incrustados (el reproductor de "embed"): tampoco
// exige tokens para los videos que permiten incrustarse.
function ctxWebEmbedded() {
  return {
    key: KEY_WEB,
    num: "56",
    etiqueta: "WEB_EMBEDDED",
    extra: { thirdParty: { embedUrl: "https://www.youtube.com/" } },
    client: {
      clientName: "WEB_EMBEDDED_PLAYER",
      clientVersion: "2.20260708.00.00",
      hl: "es-419",
      gl: paisActual(),
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)"
    }
  };
}

// Cliente VISIONOS (la app de YouTube para el Apple Vision Pro): es de los
// pocos que YouTube atiende sin exigir tokens y sin pedir el reproductor JS.
// Va primero: versión y datos exactos que usa yt-dlp.
function ctxVisionos() {
  return {
    key: null, // yt-dlp ya no manda API key: el endpoint funciona sin ella.
    num: "101",
    etiqueta: "VISIONOS",
    client: {
      clientName: "VISIONOS",
      clientVersion: "1.02",
      deviceMake: "Apple",
      deviceModel: "RealityDevice17,1",
      osName: "visionOS",
      osVersion: "26.5.23O471",
      hl: "es-419",
      gl: paisActual(),
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
    }
  };
}

// ---------- helpers de red (el mismo patrón que ya funciona en AniTrack/FlixTrack) ----------

async function fetchJson(url, options) {
  const r = await kino.fetch(url, options);
  if (!r.ok) {
    let detalle = "http " + r.status;
    try {
      const cuerpo = await r.text();
      if (cuerpo) {
        // Si YouTube explica el error en JSON, quedarnos con el mensaje.
        try {
          const j = JSON.parse(cuerpo);
          const msg = j && j.error && typeof j.error.message === "string" && j.error.message
            ? j.error.message
            : (j && j.error && typeof j.error.status === "string" ? j.error.status : "");
          detalle = msg ? detalle + " " + String(msg).slice(0, 120)
                        : detalle + " " + String(cuerpo).slice(0, 120);
        } catch (e2) {
          detalle = detalle + " " + String(cuerpo).slice(0, 120);
        }
      }
    } catch (e2) { /* sin cuerpo legible */ }
    const e = new Error(detalle);
    e.status = r.status;
    throw e;
  }
  return await r.json();
}

// Llama a la API interna de YouTube como si fuéramos la app oficial.
async function innertube(endpoint, ctx, cuerpo) {
  // yt-dlp ya no manda API key (el endpoint funciona sin ella); nosotros la
  // seguimos mandando en los clientes que siempre la llevaron, y omitimos
  // la key en los nuevos, igual que ellos.
  const url = "https://www.youtube.com/youtubei/v1/" + endpoint +
    (ctx.key ? "?key=" + ctx.key + "&prettyPrint=false" : "?prettyPrint=false");
  const payload = { context: { client: ctx.client } };
  // Algunos clientes (como el de videos incrustados) necesitan más contexto.
  if (ctx.extra) {
    for (const k in ctx.extra) payload.context[k] = ctx.extra[k];
  }
  for (const k in cuerpo) payload[k] = cuerpo[k];
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": "es-419,es;q=0.8",
      "User-Agent": ctx.client.userAgent,
      // El número que YouTube le da a cada cliente (WEB=1, ANDROID=3,
      // IOS=5, ANDROID_VR=28, WEB_EMBEDDED=56). Si no lo traemos, no se lo mandamos.
      "X-YouTube-Client-Name": String(ctx.num || "3"),
      "X-YouTube-Client-Version": ctx.client.clientVersion
    },
    body: { json: payload },
    timeoutMs: 15000
  });
}

// ---------- helpers de texto y datos ----------

// Innertube entrega los textos como {runs: [{text}]} o {simpleText}.
function runsToText(o) {
  if (!o) return "";
  if (typeof o === "string") return o;
  if (typeof o.simpleText === "string") return o.simpleText;
  if (Array.isArray(o.runs)) {
    let t = "";
    for (let i = 0; i < o.runs.length; i++) {
      if (o.runs[i] && typeof o.runs[i].text === "string") t += o.runs[i].text;
    }
    return t;
  }
  return "";
}

// "1:02:03" o "1 hora y 2 minutos" -> minutos (mínimo 1).
function parseDurMin(txt) {
  if (!txt) return 0;
  txt = String(txt).trim();
  if (/^\d+(:\d+)+$/.test(txt)) {
    const p = txt.split(":");
    const seg = parseInt(p[p.length - 1], 10) || 0;
    const min = p.length >= 2 ? (parseInt(p[p.length - 2], 10) || 0) : 0;
    const hor = p.length >= 3 ? (parseInt(p[p.length - 3], 10) || 0) : 0;
    const total = Math.round((hor * 3600 + min * 60 + seg) / 60);
    return Math.max(1, total);
  }
  let total = 0;
  const re = /(\d+)\s*(d[ií]as?|horas?|hs?|h\b|minutos?|mins?|min\b|segundos?|segs?|seg\b)/gi;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    if (u.charAt(0) === "d") total += n * 1440;
    else if (u.charAt(0) === "h") total += n * 60;
    else if (u.charAt(0) === "m") total += n;
    else total += n / 60;
  }
  if (total > 0) return Math.max(1, Math.round(total));
  return 0;
}

// Miniaturas: quedarse con la más grande (la última suele serlo).
function bestThumb(obj) {
  let lista = obj;
  if (obj && !Array.isArray(obj) && Array.isArray(obj.thumbnails)) lista = obj.thumbnails;
  if (!Array.isArray(lista) || lista.length === 0) return "";
  let mejor = "";
  let ancho = -1;
  for (let i = 0; i < lista.length; i++) {
    const t = lista[i];
    if (!t || typeof t.url !== "string" || t.url.indexOf("https://") !== 0) continue;
    const w = typeof t.width === "number" ? t.width : 0;
    if (w > ancho) { ancho = w; mejor = t.url; }
  }
  return mejor;
}

// Busca en el árbol de la respuesta cualquier renderizador por nombre.
// La estructura de YouTube cambia seguido; recorrer todo el JSON es lo
// que más sobrevive a esos cambios.
function recolectar(nodo, nombres, salida, profundidad) {
  if (!nodo || typeof nodo !== "object" || profundidad > 30) return salida;
  if (Array.isArray(nodo)) {
    for (let i = 0; i < nodo.length; i++) {
      if (salida.total >= 90) break;
      recolectar(nodo[i], nombres, salida, profundidad + 1);
    }
    return salida;
  }
  for (const clave in nodo) {
    if (!Object.prototype.hasOwnProperty.call(nodo, clave)) continue;
    const v = nodo[clave];
    if (v === null || typeof v !== "object") continue;
    if (nombres.indexOf(clave) >= 0) {
      salida.items.push({ tipo: clave, datos: v });
      salida.total++;
      continue;
    }
    if (salida.total < 90) recolectar(v, nombres, salida, profundidad + 1);
  }
  return salida;
}

function juntar(root, nombres) {
  return recolectar(root, nombres, { items: [], total: 0 }, 0).items;
}

// El token para la siguiente página de resultados.
function tokenDeContinuacion(root) {
  const hits = juntar(root, ["continuationCommand", "nextContinuationData"]);
  for (let i = 0; i < hits.length; i++) {
    const d = hits[i].datos;
    if (typeof d.token === "string" && d.token) return d.token;
    if (typeof d.continuation === "string" && d.continuation) return d.continuation;
  }
  return null;
}

// ¿Es un video en vivo? (badge "EN VIVO" o similar)
function estaEnVivo(v) {
  if (Array.isArray(v.badges)) {
    for (let i = 0; i < v.badges.length; i++) {
      const b = v.badges[i] && v.badges[i].metadataBadgeRenderer;
      const label = b ? String(b.label || "") : "";
      if (/en vivo|en directo|^live/i.test(label)) return true;
    }
  }
  return false;
}

// ---------- construcción de items ----------

function itemDeVideo(v) {
  if (!v || typeof v.videoId !== "string" || !v.videoId) return null;
  const item = {
    id: "yt.v." + v.videoId,
    ref: "v:" + v.videoId,
    title: runsToText(v.title) || "Video de YouTube",
    kind: "movie"
  };
  const poster = bestThumb(v.thumbnail);
  if (poster) item.poster = poster;
  const descrip = runsToText(v.descriptionSnippet);
  if (descrip) item.overview = descrip;
  const vivo = estaEnVivo(v);
  if (vivo) item.badges = ["EN VIVO"];
  else {
    const dur = parseDurMin(runsToText(v.lengthText));
    if (dur > 0) item.runtimeMinutes = dur;
  }
  return item;
}

function itemDeCanal(c) {
  if (!c || typeof c.channelId !== "string" || !c.channelId) return null;
  const item = {
    id: "yt.ch." + c.channelId,
    ref: "ch:" + c.channelId,
    title: runsToText(c.title) || "Canal de YouTube",
    kind: "series"
  };
  const poster = bestThumb(c.thumbnail);
  if (poster) item.poster = poster;
  const descripcion = runsToText(c.descriptionSnippet);
  const cuenta = runsToText(c.videoCountText);
  const partes = [];
  if (cuenta) partes.push(cuenta);
  if (descripcion) partes.push(descripcion);
  if (partes.length) item.overview = partes.join(" — ");
  return item;
}

function itemDeLista(p) {
  if (!p || typeof p.playlistId !== "string" || !p.playlistId) return null;
  const item = {
    id: "yt.pl." + p.playlistId,
    ref: "pl:" + p.playlistId,
    title: runsToText(p.title) || "Lista de reproducción",
    kind: "series"
  };
  const poster = bestThumb(p.thumbnails);
  if (poster) item.poster = poster;
  const cuenta = runsToText(p.videoCountText);
  const autor = runsToText(p.shortBylineText);
  const partes = [];
  if (cuenta) partes.push(cuenta);
  if (autor) partes.push(autor);
  if (partes.length) item.overview = partes.join(" — ");
  return item;
}

// ---------- búsqueda ----------

// ¿Pegaron un enlace de YouTube? -> devuelve el id del video o null.
function idDeEnlace(q) {
  if (!q) return null;
  q = q.trim();
  let m = q.match(/(?:youtube\.com\/(?:watch\?[^ ]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = q.match(/^[A-Za-z0-9_-]{11}$/);
  if (m && /^https?:\/\//.test(q) === false && q.indexOf(" ") < 0 && /[A-Z]/.test(q) && /[a-z]/.test(q) && /\d|[-_]/.test(q)) {
    // Solo si parece un id (mezcla rara de caracteres), no una palabra normal.
    return m[0];
  }
  return null;
}

async function itemDeId(id) {
  const item = {
    id: "yt.v." + id,
    ref: "v:" + id,
    title: "Video de YouTube",
    kind: "movie"
  };
  try {
    const j = await innertube("player", ctxAndroid(), { videoId: id, contentCheckOk: true, racyCheckOk: true });
    const vd = j && j.videoDetails;
    if (vd) {
      if (typeof vd.title === "string" && vd.title) item.title = vd.title;
      const poster = bestThumb(vd.thumbnail);
      if (poster) item.poster = poster;
      if (typeof vd.shortDescription === "string" && vd.shortDescription) {
        item.overview = vd.shortDescription.slice(0, 300);
      }
      if (typeof vd.lengthSeconds === "string" && parseInt(vd.lengthSeconds, 10) > 0) {
        item.runtimeMinutes = Math.max(1, Math.round(parseInt(vd.lengthSeconds, 10) / 60));
      }
      if (typeof vd.author === "string" && vd.author) item.overview = (vd.author + " — " + (item.overview || "")).slice(0, 300);
    }
  } catch (e) { /* si falla, devolvemos el item pelado: el play decidirá */ }
  return item;
}

async function buscarVideos(query, cursor, limite) {
  const cx = ctxAndroid();
  const cuerpo = cursor ? { continuation: cursor } : { query: query };
  const j = await innertube("search", cx, cuerpo);
  const hits = juntar(j, ["videoRenderer", "videoWithContextRenderer", "gridVideoRenderer", "compactVideoRenderer"]);
  const items = [];
  const vistos = {};
  for (let i = 0; i < hits.length; i++) {
    const item = itemDeVideo(hits[i].datos);
    if (!item || vistos[item.id]) continue;
    vistos[item.id] = 1;
    items.push(item);
    if (items.length >= limite) break;
  }
  return { items: items, next: tokenDeContinuacion(j) };
}

// El informe de diagnóstico como resultados de búsqueda: cada línea es un
// resultado, así el texto puede ser todo lo largo que necesite (el Estado de
// Ajustes se corta en 200 caracteres).
function informeDebug() {
  const lineas = [];
  lineas.push("TubeKino " + VERSION + " — informe técnico. (Estas líneas no se pueden reproducir.)");
  lineas.push("Config: método=" + String(kino.config.get("metodo") || "auto") +
    ", calidad=" + String(kino.config.get("calidad") || "mejor") +
    ", país=" + paisActual());
  if (ultimoResolve) {
    lineas.push("Último video: vía=" + ultimoResolve.via +
      ", altura=" + ultimoResolve.altura +
      (ultimoResolve.hls ? ", HLS" : "") +
      (ultimoResolve.vivo ? ", en vivo" : ""));
  } else {
    lineas.push("Último video: (nada reproducido desde que se actualizó el plugin)");
  }
  lineas.push("Traza directo: " + (trazaDirecto || "(vacía: el directo aún no se ha probado)"));
  // Qué le respondió YouTube a cada cliente en el último intento directo.
  if (trazaClientes.length > 0) {
    lineas.push("Clientes probados en el último video (en orden):");
    for (let i = 0; i < trazaClientes.length; i++) {
      lineas.push("  - " + trazaClientes[i]);
    }
  } else {
    lineas.push("Clientes: (el directo aún no se ha probado)");
  }
  lineas.push("Último navegador: " + (ultimoNavegador
    ? ("altura=" + ultimoNavegador.altura + ", hls=" + (ultimoNavegador.hls ? "sí" : "no"))
    : "(no usado)"));
  lineas.push("Portada: " + (trazaTendencias || "(la portada aún no se ha abierto)"));
  const items = [];
  for (let i = 0; i < lineas.length; i++) {
    // Líneas largas se parten en varios resultados para que nada se corte.
    let resto = lineas[i];
    let n = 1;
    while (resto.length > 0) {
      items.push({
        id: "yt.debug." + i + "." + n,
        ref: "v:debug" + i + "x" + n,
        title: resto.slice(0, 110),
        kind: "movie"
      });
      resto = resto.slice(110);
      n = n + 1;
    }
  }
  return items;
}

export async function search(query) {
  const q = query && query.q ? String(query.q).trim() : "";
  if (!q) return [];

  // Informe técnico: "Estado" en Ajustes solo muestra un resumen, así que
  // escribir "debug" (o "estado") en el buscador devuelve el detalle completo.
  const qLower = q.toLowerCase();
  if (qLower === "debug" || qLower === "estado") return informeDebug();

  // Enlace pegado: directo al video.
  const idLink = idDeEnlace(q);
  if (idLink) {
    const item = await itemDeId(idLink);
    return [item];
  }

  // Búsqueda normal: videos, y también canales y listas que coincidan.
  const j = await innertube("search", ctxAndroid(), { query: q });
  return itemsDeRespuesta(j, 30);
}

// Convierte una respuesta de búsqueda en items de Kino: videos, canales y listas.
function itemsDeRespuesta(j, limite) {
  const items = [];
  const vistos = {};
  const hits = juntar(j, [
    "videoRenderer", "videoWithContextRenderer", "gridVideoRenderer", "compactVideoRenderer",
    "channelRenderer", "playlistRenderer"
  ]);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    let item = null;
    if (h.tipo === "channelRenderer") item = itemDeCanal(h.datos);
    else if (h.tipo === "playlistRenderer") item = itemDeLista(h.datos);
    else item = itemDeVideo(h.datos);
    if (!item || vistos[item.id]) continue;
    vistos[item.id] = 1;
    items.push(item);
    if (items.length >= limite) break;
  }
  return items;
}

// ---------- portada ----------

// YouTube eliminó las tendencias: desde noviembre de 2025 la página
// /feed/trending redirige a la portada y la API FEtrending responde 400
// "Request contains an invalid argument" para todos los clientes (les pasa
// también a Invidious y YouTube.js). Así que la portada son filas por temas
// hechas con búsqueda real: siempre frescas y siempre funcionan.
const TEMAS_PORTADA = [
  { q: "músicas del momento", titulo: "Lo del momento — música" },
  { q: "videojuegos del momento", titulo: "Lo del momento — videojuegos" },
  { q: "noticias de hoy", titulo: "Lo del momento — noticias" },
  { q: "virales del momento", titulo: "Lo del momento — virales" },
  { q: "deportes de hoy", titulo: "Lo del momento — deportes" },
  { q: "tecnología del momento", titulo: "Lo del momento — tecnología" },
  { q: "estrenos de cine", titulo: "Lo del momento — cine" }
];

const FILAS_PORTADA = [
  { id: "trailers", title: "Trailers y avances de películas", q: "trailer oficial película", genre: "peliculas" },
  { id: "documentales", title: "Documentales completos", q: "documental completo en español", genre: "documentales" },
  { id: "musica", title: "Conciertos y música", q: "concierto completo", genre: "musica" },
  { id: "juegos", title: "Gameplays y videojuegos", q: "gameplay en español", genre: "entretenimiento" }
];

export async function home() {
  const salida = [];
  // La primera fila cambia con el día para que la portada no se sienta
  // siempre igual; el resto son los temas fijos.
  const dia = new Date().getUTCDate();
  const tema = TEMAS_PORTADA[dia % TEMAS_PORTADA.length];
  const filas = [{ id: "dia", title: tema.titulo, q: tema.q, genre: "tendencias" }]
    .concat(FILAS_PORTADA);
  let ok = 0;
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    try {
      const r = await buscarVideos(f.q, null, 18);
      if (r.items.length > 0) {
        ok = ok + 1;
        salida.push({
          id: "fila." + f.id,
          title: f.title,
          items: r.items,
          ref: "search:" + f.q,
          genre: f.genre
        });
      }
    } catch (e) { /* fila omitida, las demás siguen */ }
  }
  trazaTendencias = "portada por temas: " + ok + "/" + filas.length +
    " filas (YouTube quitó las tendencias)";
  if (salida.length === 0) throw kino.error("unavailable", "home sin filas");
  return salida;
}

// ---------- páginas (Ver más) ----------

async function paginaDeBusqueda(q, cursor) {
  const r = await buscarVideos(q, cursor, 30);
  return { items: r.items, next: r.next || undefined };
}

async function paginaDeLista(playlistId, cursor) {
  const cx = ctxAndroid();
  const cuerpo = cursor ? { continuation: cursor } : { browseId: "VL" + playlistId };
  const j = await innertube("browse", cx, cuerpo);
  const hits = juntar(j, ["playlistVideoRenderer", "videoRenderer"]);
  const items = [];
  const vistos = {};
  for (let i = 0; i < hits.length; i++) {
    const item = itemDeVideo(hits[i].datos);
    if (!item || vistos[item.id]) continue;
    vistos[item.id] = 1;
    items.push(item);
    if (items.length >= 40) break;
  }
  return { items: items, next: tokenDeContinuacion(j) || undefined };
}

async function paginaDeCanal(channelId, cursor) {
  const cx = ctxAndroid();
  const cuerpo = cursor
    ? { continuation: cursor }
    : { browseId: channelId, params: "EgZ2aWRlb3PyBgQKAjoA" };
  const j = await innertube("browse", cx, cuerpo);
  const hits = juntar(j, ["videoRenderer", "gridVideoRenderer", "playlistVideoRenderer"]);
  const items = [];
  const vistos = {};
  for (let i = 0; i < hits.length; i++) {
    const item = itemDeVideo(hits[i].datos);
    if (!item || vistos[item.id]) continue;
    vistos[item.id] = 1;
    items.push(item);
    if (items.length >= 40) break;
  }
  return { items: items, next: tokenDeContinuacion(j) || undefined };
}

export async function browse(ref, cursor) {
  ref = String(ref || "");
  if (ref.indexOf("search:") === 0) return paginaDeBusqueda(ref.slice(7), cursor);
  if (ref.indexOf("pl:") === 0) return paginaDeLista(ref.slice(3), cursor);
  if (ref.indexOf("ch:") === 0) return paginaDeCanal(ref.slice(3), cursor);
  throw kino.error("not_found", "browse ref " + ref.slice(0, 60));
}

// ---------- episodios (canal o lista como temporada única) ----------

export async function episodes(ref) {
  ref = String(ref || "");
  if (ref.indexOf("v:") === 0) {
    return { episodes: [{ number: 1, ref: ref }] };
  }
  let eps = [];
  if (ref.indexOf("pl:") === 0) {
    const r = await paginaDeLista(ref.slice(3), null);
    eps = r.items;
  } else if (ref.indexOf("ch:") === 0) {
    const r = await paginaDeCanal(ref.slice(3), null);
    eps = r.items;
  } else {
    throw kino.error("not_found", "episodes ref " + ref.slice(0, 60));
  }
  const episodios = [];
  for (let i = 0; i < eps.length && i < 100; i++) {
    const it = eps[i];
    const ep = {
      number: i + 1,
      ref: it.ref,
      title: it.title
    };
    if (it.poster) ep.still = it.poster;
    if (it.runtimeMinutes) ep.runtimeMinutes = it.runtimeMinutes;
    episodios.push(ep);
  }
  if (episodios.length === 0) throw kino.error("not_found", "sin episodios");
  return { episodes: episodios };
}

// ---------- resolución: el corazón del plugin ----------

function refAVideoId(ref) {
  let s = String(ref || "");
  if (s.indexOf("v:") === 0) s = s.slice(2);
  if (s.indexOf("e:") === 0) s = s.slice(2);
  if (!/^[A-Za-z0-9_-]{11}$/.test(s)) return null;
  return s;
}

// ¿El formato trae el audio incluido? (mp4a/opus/vorbis en los códecs)
function tieneAudio(f) {
  const mt = String(f.mimeType || "");
  return mt.indexOf("mp4a") >= 0 || mt.indexOf("opus") >= 0 || mt.indexOf("vorbis") >= 0;
}

function altura(f) {
  if (typeof f.height === "number") return f.height;
  if (f.qualityLabel && /^\d+p$/.test(String(f.qualityLabel))) {
    return parseInt(String(f.qualityLabel), 10);
  }
  return 0;
}

// Tope de calidad elegido en Ajustes ("mejor" no pone tope).
function capDeCalidad() {
  const q = String(kino.config.get("calidad") || "mejor").trim();
  if (q === "720") return 720;
  if (q === "1080") return 1080;
  return 2160;
}

// El "itag" es el número que YouTube le pone a cada formato; en las URLs
// capturadas por el navegador no siempre viene la altura, pero el itag sí.
const ITAG_ALTURA = {
  18: 360, 22: 720,
  134: 360, 133: 240, 135: 480, 136: 720, 137: 1080, 138: 2160, 160: 144,
  264: 1440, 266: 2160, 298: 720, 299: 1080,
  394: 144, 395: 240, 396: 360, 397: 480, 398: 720, 399: 1080, 400: 1440, 401: 2160
};

function itagDeUrl(url) {
  const m = String(url).match(/itag(?:=|\/)(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

// Altura de una URL capturada (height/quality_label explícitos o vía itag).
function alturaDeUrl(url) {
  const s = String(url);
  let m = s.match(/height(?:=|%3D|\/)(\d{3,4})/i) ||
          s.match(/quality_label(?:=|%3D|\/)(\d{3,4})p?/i);
  if (m) return parseInt(m[1], 10);
  const it = itagDeUrl(s);
  return ITAG_ALTURA[it] || 0;
}

// Ranking de pistas de audio mp4 por itag (140 es la estándar y mejor).
const ITAG_AUDIO = { 140: 4, 258: 3, 256: 2, 139: 1 };

function rangoAudioDeUrl(url) {
  const s = String(url);
  const m = s.match(/average_bitrate(?:=|\/)(\d+)/i) || s.match(/bitrate(?:=|\/)(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return (ITAG_AUDIO[itagDeUrl(s)] || 0) * 1000;
}

// Vía directa: pedir los formatos a Innertube como app oficial.
// Cada intento queda registrado en trazaClientes (visible con "debug"):
// es lo que nos dice QUÉ le respondió YouTube a cada cliente.
async function resolverDirectoBase(videoId) {
  let detalle = "";
  trazaClientes = [];
  // El mejor resultado de calidad baja se guarda y la cadena sigue: si
  // ANDROID sin SDK solo trae 360p, probamos los demás por si traen HD.
  // Con 720p o más nos quedamos con ese cliente y no gastamos más tiempo.
  let mejor = null;
  // Primero los clientes a los que hoy YouTube NO exige tokens, según la
  // investigación de yt-dlp: VISIONOS (la app de Vision Pro), la app VR
  // (formatos con enlaces hasta 1080p+) y ANDROID sin SDK. Luego el
  // reproductor incrustado y el WEB de Safari (HLS). IPhone y Android van
  // al final: a ellos sí les exige tokens y suelen caer en 360p.
  const clientes = [ctxVisionos(), ctxVr(), ctxAndroidSdkless(), ctxWebEmbedded(), ctxWebSafari(), ctxIos(), ctxAndroid()];
  for (let i = 0; i < clientes.length; i++) {
    const cx = clientes[i];
    const et = cx.etiqueta || cx.client.clientName;
    let j = null;
    try {
      j = await innertube("player", cx, { videoId: videoId, contentCheckOk: true, racyCheckOk: true });
    } catch (e) {
      const men = String(e && e.message ? e.message : e).slice(0, 100);
      detalle = detalle + " [" + et + ": " + men + "]";
      trazaClientes.push(et + ": " + men);
      continue;
    }
    const ps = j && j.playabilityStatus;
    if (!ps || ps.status !== "OK") {
      const men = String(ps && ps.reason ? ps.reason : ps ? ps.status : "sin respuesta").slice(0, 100);
      detalle = detalle + " [" + et + ": " + men + "]";
      trazaClientes.push(et + ": " + men);
      continue;
    }
    const sd = j.streamingData;
    if (!sd) {
      detalle = detalle + " [" + et + ": sin streamingData]";
      trazaClientes.push(et + ": sin streamingData");
      continue;
    }

    // Manifiesto HLS: no necesita tokens y trae varias calidades. Es la vía
    // de calidad del cliente de iPhone (también cubre los en vivo).
    if (typeof sd.hlsManifestUrl === "string" && sd.hlsManifestUrl.indexOf("https://") === 0) {
      trazaDirecto = et + " HLS";
      trazaClientes.push(et + ": HLS ✓");
      return {
        url: sd.hlsManifestUrl,
        mime: "application/vnd.apple.mpegurl",
        headers: { "User-Agent": cx.client.userAgent },
        esVivo: !!(j.videoDetails && j.videoDetails.isLive === true)
      };
    }

    const formats = Array.isArray(sd.formats) ? sd.formats : [];
    const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
    const cap = capDeCalidad();

    // Formatos completos (video + audio en el mismo archivo): confiables,
    // pero YouTube solo los entrega en 360p/720p. Quedan de plan B.
    const completos = [];
    for (let k = 0; k < formats.length; k++) {
      const f = formats[k];
      if (f && typeof f.url === "string" && f.url.indexOf("https://") === 0 &&
          String(f.mimeType || "").indexOf("video/") === 0 && tieneAudio(f) &&
          altura(f) <= cap) {
        completos.push(f);
      }
    }

    // Video y audio por separado: aquí vive la calidad alta (1080p y más).
    const vids = [];
    const auds = [];
    for (let k = 0; k < adaptive.length; k++) {
      const f = adaptive[k];
      if (!f || typeof f.url !== "string" || f.url.indexOf("https://") !== 0) continue;
      const mt = String(f.mimeType || "");
      if (mt.indexOf("video/mp4") === 0 && altura(f) <= cap) vids.push(f);
      else if (mt.indexOf("audio/mp4") === 0) auds.push(f);
    }

    vids.sort(function (a, b) { return altura(b) - altura(a); });
    auds.sort(function (a, b) {
      return (b.averageBitrate || b.bitrate || 0) - (a.averageBitrate || a.bitrate || 0);
    });
    completos.sort(function (a, b) { return altura(b) - altura(a); });

    // ¿Qué candidato trae este cliente? (video+audio > combinado > sin audio)
    let st = null;
    let al = 0;
    let texto = "";
    if (vids.length > 0 && auds.length > 0 &&
        (completos.length === 0 || altura(vids[0]) > altura(completos[0]))) {
      st = {
        url: vids[0].url,
        mime: "video/mp4",
        headers: { "User-Agent": cx.client.userAgent },
        audioTracks: [{ lang: "und", url: auds[0].url }]
      };
      al = altura(vids[0]);
      texto = et + " " + al + "p+audio";
    } else if (completos.length > 0) {
      st = { url: completos[0].url, mime: "video/mp4", headers: { "User-Agent": cx.client.userAgent } };
      al = altura(completos[0]);
      texto = et + " " + al + "p";
    } else if (vids.length > 0) {
      st = { url: vids[0].url, mime: "video/mp4", headers: { "User-Agent": cx.client.userAgent } };
      al = altura(vids[0]);
      texto = et + " " + al + "p sin audio";
    }
    if (st) {
      trazaClientes.push(et + ": " + texto.slice(et.length + 1) + " ✓");
      // Con calidad alta (720p o el tope si es menor) nos quedamos ya.
      const aceptable = cap < 720 ? cap : 720;
      if (al >= aceptable) {
        trazaDirecto = texto;
        return st;
      }
      if (!mejor || al > mejor.altura) mejor = { stream: st, altura: al, traza: texto };
    } else {
      // Llegó respuesta pero sin nada utilizable: casi siempre es que YouTube
      // entregó los formatos SIN enlaces (exigiendo tokens). Que la traza lo
      // diga claro, con cuántos formatos y cuántos con enlace.
      let total = formats.length + adaptive.length;
      let conEnlace = 0;
      for (let k = 0; k < formats.length; k++) {
        if (formats[k] && typeof formats[k].url === "string") conEnlace++;
      }
      for (let k = 0; k < adaptive.length; k++) {
        if (adaptive[k] && typeof adaptive[k].url === "string") conEnlace++;
      }
      const men = "sin enlaces (" + conEnlace + "/" + total + " formatos con URL)";
      detalle = detalle + " [" + et + ": " + men + "]";
      trazaClientes.push(et + ": " + men);
    }
  }
  // Ninguno dio calidad alta: nos quedamos con el mejor de los bajos.
  if (mejor) {
    trazaDirecto = mejor.traza;
    return mejor.stream;
  }
  trazaDirecto = "falla: " + detalle.slice(0, 80);
  const e = new Error("directo falló:" + detalle);
  e.esDirecto = true;
  throw e;
}

// Vía navegador oculto: la página real de YouTube hace la magia (tokens
// incluidos) y Kino nos entrega los enlaces que el reproductor generó.
async function resolverNavegadorBase(videoId) {
  if (!kino.browser || typeof kino.browser.capture !== "function") {
    throw kino.error("unavailable", "este Kino no trae navegador oculto");
  }
  const url = "https://www.youtube.com/watch?v=" + videoId;
  const opts = { match: "videoplayback", timeoutMs: 22000 };
  if (kino.browser.captureAll === true) opts.captureAll = true;

  let page;
  try {
    page = await kino.browser.capture(url, opts);
  } catch (e) {
    const code = e && e.code ? e.code : "";
    if (code === "blocked") {
      throw kino.error("unavailable", "captura bloqueada", {
        userMessage: "La página pidió confirmar que eres una persona; no se puede continuar."
      });
    }
    if (code === "timeout") {
      throw kino.error("not_found", "captura sin video a tiempo", {
        userMessage: "El video no empezó a tiempo. Inténtalo de nuevo en un momento."
      });
    }
    if (code === "busy") {
      throw kino.error("rate_limited", "captura ocupada");
    }
    throw kino.error("unavailable", "captura falló: " + code);
  }

  // Con captureAll llegan todas las peticiones; sin él, la primera.
  let crudos = [];
  if (page && Array.isArray(page.requests) && page.requests.length > 0) crudos = page.requests;
  else if (page && Array.isArray(page.media)) crudos = page.media;

  // Quitar anuncios: viven en las mismas URLs pero con ctier y compañía.
  const limpias = [];
  for (let i = 0; i < crudos.length; i++) {
    const m = crudos[i];
    if (!m || typeof m.url !== "string") continue;
    if (/ctier|adformat|pagead|doubleclick|\/ads?\//i.test(m.url)) continue;
    limpias.push(m);
  }

  // En vivo: manifiesto HLS.
  for (let i = 0; i < limpias.length; i++) {
    if (/\.m3u8/i.test(limpias[i].url)) {
      const s = { url: limpias[i].url, mime: "application/vnd.apple.mpegurl", esVivo: true };
      if (limpias[i].headers) s.headers = limpias[i].headers;
      return s;
    }
  }

  // Video por un lado, audio por el otro (el reproductor de la página pide
  // las dos pistas por separado; Kino las une).
  const esVideo = function (m) {
    if (m.mime && String(m.mime).indexOf("video/") === 0) return true;
    return /(mime=|mime%3D|mime\/)video/i.test(m.url);
  };
  const esAudio = function (m) {
    if (m.mime && String(m.mime).indexOf("audio/") === 0) return true;
    return /(mime=|mime%3D|mime\/)audio/i.test(m.url);
  };

  const vids = [];
  const auds = [];
  for (let i = 0; i < limpias.length; i++) {
    const m = limpias[i];
    if (esVideo(m)) vids.push(m);
    else if (esAudio(m)) auds.push(m);
  }

  if (vids.length > 0) {
    // Preferir mp4 sobre webm y, entre los mp4, la mejor altura dentro del tope.
    const cap = capDeCalidad();
    const mp4 = [];
    for (let i = 0; i < vids.length; i++) {
      if (/(?:mime=|mime%3D|mime\/)video(?:%2f|\/)mp4/i.test(vids[i].url)) mp4.push(vids[i]);
    }
    let principal = null;
    if (mp4.length > 0) {
      mp4.sort(function (a, b) { return alturaDeUrl(b.url) - alturaDeUrl(a.url); });
      for (let i = 0; i < mp4.length; i++) {
        if (alturaDeUrl(mp4[i].url) <= cap) { principal = mp4[i]; break; }
      }
      if (!principal) principal = mp4[mp4.length - 1];
    }
    if (!principal) principal = vids[0];
    const stream = { url: principal.url, mime: "video/mp4" };
    if (principal.headers) stream.headers = principal.headers;
    // Si el elegido ya trae el audio incluido (itag 18/22), no hay que unir nada.
    const it = itagDeUrl(principal.url);
    if (it !== 18 && it !== 22 && auds.length > 0) {
      auds.sort(function (a, b) { return rangoAudioDeUrl(b.url) - rangoAudioDeUrl(a.url); });
      let audio = null;
      for (let i = 0; i < auds.length; i++) {
        if (/(?:mime=|mime%3D|mime\/)audio(?:%2f|\/)mp4/i.test(auds[i].url)) { audio = auds[i]; break; }
      }
      if (!audio) audio = auds[0];
      stream.audioTracks = [{ lang: "und", url: audio.url }];
    }
    return stream;
  }

  throw kino.error("not_found", "captura sin video", {
    userMessage: "No se encontró el enlace del video. Inténtalo de nuevo en un momento."
  });
}

// Envoltorios: resuelven y dejan constancia de la calidad lograda (para
// Ajustes → Estado y para que el modo automático compare y elija).
function infoDeStream(s) {
  if (!s || !s.url) return { altura: 0, vivo: false };
  if (String(s.mime || "").indexOf("mpegurl") >= 0) {
    // HLS: varias calidades en un manifiesto; los en vivo traen esVivo.
    return { altura: 0, vivo: s.esVivo !== false, hls: true };
  }
  return { altura: alturaDeUrl(s.url), vivo: false };
}

async function resolverDirecto(videoId) {
  const s = await resolverDirectoBase(videoId);
  ultimoDirecto = infoDeStream(s);
  ultimoDirecto.via = "directo";
  ultimoResolve = ultimoDirecto;
  return s;
}

async function resolverNavegador(videoId) {
  const s = await resolverNavegadorBase(videoId);
  ultimoNavegador = infoDeStream(s);
  ultimoNavegador.via = "navegador";
  ultimoResolve = ultimoNavegador;
  return s;
}

export async function resolve(ref, options) {
  const videoId = refAVideoId(ref);
  if (!videoId) throw kino.error("not_found", "ref no es un video: " + String(ref).slice(0, 60));

  const metodo = String((kino.config.get("metodo") || "auto")).trim();
  const reintento = options && options.retry ? (options.retry.attempt || 2) : 0;

  if (metodo === "directo") {
    try {
      return await resolverDirecto(videoId);
    } catch (e) {
      throw kino.error("not_found", "directo: " + String(e && e.message ? e.message : e).slice(0, 150), {
        userMessage: "La extracción directa no logró el enlace de este video."
      });
    }
  }
  if (metodo === "navegador") return await resolverNavegador(videoId);

  // Automático: directo primero. Si falla (o el reproductor recibió un enlace
  // vencido y Kino reintenta), navegador oculto.
  if (reintento === 0) {
    let directo = null;
    let alturaDirecto = 0;
    try {
      directo = await resolverDirecto(videoId);
      alturaDirecto = ultimoDirecto ? ultimoDirecto.altura : 0;
    } catch (e) { /* seguimos con el navegador */ }

    if (directo) {
      // Si el directo funcionó pero quedó en calidad baja (menos de 720p),
      // probamos el navegador oculto por si la página real consigue más.
      const vivo = String(directo.mime || "").indexOf("mpegurl") >= 0;
      if (!vivo && alturaDirecto > 0 && alturaDirecto < 720) {
        try {
          const nave = await resolverNavegador(videoId);
          const alturaNave = ultimoNavegador ? ultimoNavegador.altura : 0;
          if (alturaNave > alturaDirecto) return nave;
          trazaDirecto = trazaDirecto + "; navegador " + (alturaNave || 0) + "p";
        } catch (e) {
          trazaDirecto = trazaDirecto + "; navegador falló" +
            (e && e.code ? " (" + e.code + ")" : "");
        }
      }
      ultimoResolve = ultimoDirecto;
      return directo;
    }
  }
  return await resolverNavegador(videoId);
}

// ---------- estado en Ajustes ----------

export async function settingsStatus() {
  const metodo = String((kino.config.get("metodo") || "auto")).trim();
  const cap = capDeCalidad();
  const calidad = cap >= 2160 ? "la mejor disponible" : "hasta " + cap + "p";
  let texto = "TubeKino " + VERSION + ".";
  if (metodo === "directo") texto = texto + " Solo directo.";
  else if (metodo === "navegador") texto = texto + " Solo navegador.";
  else texto = texto + " Auto: directo→navegador.";
  texto = texto + " Calidad: " + calidad + ".";
  if (ultimoResolve) {
    if (ultimoResolve.vivo) texto = texto + " Último: en vivo.";
    else if (ultimoResolve.hls) texto = texto + " Último: HLS (" + ultimoResolve.via + ").";
    else if (ultimoResolve.altura > 0) {
      texto = texto + " Último: " + ultimoResolve.altura + "p (" + ultimoResolve.via + ").";
    }
  }
  // La traza de directo dice QUÉ cliente sirvió el video: es la clave cuando
  // la calidad sale baja. Va antes que lo demás para que no la corte el límite.
  if (ultimoResolve && ultimoResolve.via === "directo" && !ultimoResolve.hls &&
      ultimoResolve.altura > 0 && ultimoResolve.altura < 720 && trazaDirecto) {
    texto = texto + " Directo: " + trazaDirecto.slice(0, 60) + ".";
  }
  texto = texto + " Detalle: busca 'debug'.";
  return { estado: texto.slice(0, 200) };
}
