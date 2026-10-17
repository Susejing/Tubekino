// TubeKino 0.3.19 — YouTube en Kino: búsqueda, listas, canales y reproducción.
//
// Cómo funciona: YouTube no entrega los enlaces de video así nada más.
// Este plugin usa la misma API interna que las apps oficiales de YouTube
// (Innertube) para buscar y para pedir los formatos directamente. La calidad
// alta está en el HLS de la página del video presentándonos como un Safari
// de verdad (un manifiesto con varias calidades) — llega por rachas, así que
// se reintenta. Y si el directo falla del todo, la red de seguridad es el
// navegador oculto de Kino, con una excepción: el reproductor web nuevo de
// YouTube (SABR) genera enlaces internos que solo él sabe usar; si la
// captura trae solo eso, se descarta. El navegador oculto es un WebView,
// lo que más memoria consume en el aparato, así que NO se abre en cada
// video para buscar calidad: solo si el directo falla del todo.
// ¿Y si YouTube solo da 360p? El plan B son los "respaldos": servidores
// públicos de los forks libres de YouTube (Invidious y Piped) que sí
// resuelven los tokens anti-bot en sus servidores y entregan un enlace
// de calidad alta. Son ~20 instancias: si una está caída, se pasa a la
// siguiente y la que funciona se recuerda para el próximo video.
// Los respaldos también saben buscar: si la memoria del aparato no aguanta
// las respuestas grandes de la búsqueda de YouTube ("out of memory"), se
// busca en ellos — sus respuestas son livianas — y durante media hora no
// se vuelve a gastar memoria en YouTube. En Ajustes, "Búsqueda liviana"
// en "Sí" busca SIEMPRE en los respaldos: en aparatos con poca RAM es lo
// recomendado (la memoria ni se entera).
//
// En el buscador de Kino también puedes pegar un enlace de YouTube
// (youtu.be/..., youtube.com/watch?v=..., /shorts/..., /live/...) y se abre
// directo.

const VERSION = "0.3.19";

// Diagnóstico: qué sirvió cada vía en el último video (se ve en Ajustes).
let ultimoDirecto = null;
let ultimoNavegador = null;
let ultimoResolve = null;

// Diagnóstico de la portada: cuántas filas se pudieron armar (en Estado y en
// el informe "debug").
let trazaTendencias = "";

// Diagnóstico de búsqueda: qué camino sirvió la última búsqueda (en "debug").
let trazaBusqueda = "";

// ¿Cuántas búsquedas de YouTube seguidas reventaron por memoria? Al primer
// reviente ya se busca directo en los respaldos (respuestas livianas) durante
// media hora; después YouTube vuelve a ser el primero.
let rachaBusqMem = 0;
let ultBusqMem = 0;

// La instancia de respaldo que sirvió la última búsqueda ("base|api").
let busquedaBuena = "";
let cursorBusqueda = 0; // por cuál instancia de búsqueda vamos (rotar si caen)

// Diagnóstico de reproducción: por dónde y en qué calidad salió el video.
let trazaDirecto = "";

// Diagnóstico cliente por cliente: qué le respondió YouTube a cada uno en el
// último video (se ve con "debug"). Cada entrada es una línea.
let trazaClientes = [];

// Diagnóstico del navegador oculto: qué capturó y qué eligió (en "debug").
let trazaNavegador = "";

// ¿Cuántas veces seguidas la página del video llegó sin HLS? Si YouTube no
// está entregando HLS a esta conexión, no vale la pena reintentar en cada
// reproducción: tras varias seguidas, se pide la página una sola vez.
let rachaPaginaSinHls = 0;

// ¿Cuántas capturas del navegador seguidas trajeron solo enlaces SABR (no
// reproducibles)? El navegador oculto ya no se usa como mejora de calidad
// (consume mucha memoria y la página nueva solo entrega SABR): queda como
// respaldo únicamente si el directo falla del todo.
let rachaNavegadorSabr = 0;

// Diagnóstico de los respaldos (forks de YouTube): qué instancia sirvió
// el último video o qué le pasó a cada una (se ve con "debug").
let trazaRespaldos = "";
let ultimoRespaldo = null;

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
          // El error puede venir como objeto ({message}) o como texto plano
          // (así responde Invidious: {"error":"..."}).
          const msg = j && j.error && typeof j.error.message === "string" && j.error.message
            ? j.error.message
            : (j && typeof j.error === "string" && j.error)
              ? j.error
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
  // "out of memory" le pasa a este aparato cuando la memoria queda apretada
  // (a veces el reproductor o el sistema la dejan así). Un respiro y una
  // segunda oportunidad: casi siempre pasa.
  let ultimoError = null;
  for (let intento = 0; intento < 2; intento++) {
    try {
      return await fetchJson(url, {
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
    } catch (e) {
      ultimoError = e;
      const men = String(e && e.message ? e.message : e);
      if (intento === 0 && /memory/i.test(men)) {
        await esperar(500);
        continue;
      }
      throw e;
    }
  }
  throw ultimoError;
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
  // Quién lo subió: el canal viaja como "título original" (Kino lo muestra
  // junto al título) y también en la descripción del detalle.
  const canal = runsToText(v.ownerText) || runsToText(v.longBylineText) || "";
  if (canal) item.originalTitle = canal.slice(0, 120);
  const vistas = runsToText(v.viewCountText) || runsToText(v.shortViewCountText) || "";
  const hace = runsToText(v.publishedTimeText) || "";
  const descrip = runsToText(v.descriptionSnippet) || "";
  const partes = [];
  if (canal) partes.push("Canal: " + canal);
  if (vistas) partes.push(vistas);
  if (hace) partes.push(hace);
  if (descrip) partes.push(descrip);
  if (partes.length) item.overview = partes.join(" · ").slice(0, 300);
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

// ---------- búsqueda liviana en los respaldos ----------
// A este aparato la memoria le queda corta para las respuestas grandes de la
// búsqueda de YouTube (revienta con "out of memory" aunque lo demás vaya
// bien, incluso recién reiniciado). Las instancias de los forks también
// buscan por ti y sus respuestas son muchísimo más livianas: solo una lista
// de videos. Si la búsqueda de YouTube revienta por memoria, se busca aquí
// (y con UN solo reviente, media hora sin gastar memoria en YouTube). En
// Ajustes, "Búsqueda liviana" en "Sí" busca SIEMPRE aquí.

// ¿El error es de memoria? (así lo dice Kino: "out of memory").
function esErrorMemoria(e) {
  return /memory/i.test(String(e && e.message ? e.message : e));
}

// Modo de búsqueda (Ajustes "Búsqueda liviana"): "si" = siempre respaldos
// (nunca se gasta memoria en YouTube), "no" = solo YouTube, "auto" = YouTube
// primero y respaldos si la memoria revienta.
function modoBusqueda() {
  const m = String(kino.config.get("busqliviana") || "auto").trim().toLowerCase();
  return m === "si" || m === "no" ? m : "auto";
}

// ¿Le toca a YouTube buscar? En modo "Sí", nunca. En "auto", basta UN solo
// reviente de memoria para irse a los respaldos media hora (antes pedía 3).
function youtubeBuscable() {
  if (modoBusqueda() === "si") return false;
  if (rachaBusqMem < 1) return true;
  if (Date.now() - ultBusqMem > 1800000) {
    rachaBusqMem = 0;
    return true;
  }
  return false;
}

function notaBusqMemoria(e) {
  rachaBusqMem = rachaBusqMem + 1;
  ultBusqMem = Date.now();
  trazaBusqueda = "YouTube: " + String(e && e.message ? e.message : e).slice(0, 60) + " → respaldos";
}

// El poster más grande de una lista de miniaturas (Invidious las trae peladas).
function mejorThumbLista(arr) {
  if (!Array.isArray(arr)) return null;
  let mejor = null;
  let ancho = -1;
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i];
    if (t && typeof t.url === "string" && t.url.indexOf("http") === 0 && (t.width || 0) >= ancho) {
      mejor = t.url;
      ancho = t.width || 0;
    }
  }
  return mejor;
}

function itemDeRespaldo(id, titulo, poster, segundos, vivo, canal, vistas) {
  const item = {
    id: "yt.v." + id,
    ref: "v:" + id,
    title: String(titulo || "Video"),
    kind: "movie"
  };
  if (poster) item.poster = poster;
  if (canal) item.originalTitle = String(canal).slice(0, 120);
  if (vistas) item.overview = String(vistas).slice(0, 200);
  if (vivo) item.badges = ["EN VIVO"];
  else if (segundos > 0) item.runtimeMinutes = Math.max(1, Math.round(segundos / 60));
  return item;
}

// Le pide la búsqueda a una instancia (Invidious o Piped).
async function pedirBusqueda(ent, q, pagina, limite) {
  const cab = {
    "Accept": "application/json",
    "User-Agent": ctxWeb().client.userAgent,
    "Accept-Language": "es-419,es;q=0.8"
  };
  if (ent.api === "piped") {
    if (pagina > 1) return []; // Piped solo entrega la primera página.
    const j = await fetchJson(ent.base + "/search?q=" + encodeURIComponent(q) + "&filter=videos", {
      method: "GET", headers: cab, timeoutMs: 6000
    });
    const arr = Array.isArray(j && j.items) ? j.items : [];
    const items = [];
    for (let k = 0; k < arr.length && items.length < limite; k++) {
      const s = arr[k];
      const m = /(?:\?v=|\/watch\/)([A-Za-z0-9_-]{11})/.exec(String(s && s.url || ""));
      if (!m) continue;
      items.push(itemDeRespaldo(m[1], s.title, typeof s.thumbnail === "string" ? s.thumbnail : null, s.durationSeconds || 0, false, s.uploaderName || "", s.views > 0 ? s.views + " vistas" : ""));
    }
    return items;
  }
  // Invidious: una página de resultados por vez (para el "Ver más").
  const j = await fetchJson(ent.base + "/api/v1/search?q=" + encodeURIComponent(q) + "&type=video&page=" + pagina, {
    method: "GET", headers: cab, timeoutMs: 6000
  });
  const arr = Array.isArray(j) ? j : [];
  const items = [];
  for (let k = 0; k < arr.length && items.length < limite; k++) {
    const v = arr[k];
    if (!v || typeof v.videoId !== "string" || v.videoId.length !== 11) continue;
    items.push(itemDeRespaldo(v.videoId, v.title, mejorThumbLista(v.videoThumbnails), v.lengthSeconds || 0, v.liveNow === true, v.author || "", v.viewCount > 0 ? v.viewCount + " vistas" : ""));
  }
  return items;
}

// Busca en los respaldos (a lo sumo 3 instancias; la que sirve se recuerda).
async function buscarRespaldo(q, cursor, limite) {
  const propio = String(kino.config.get("servidor") || "").trim().replace(/\/+$/, "");
  const usarPublicos = String(kino.config.get("respaldo") || "si").trim() !== "no";
  if (!propio && !usarPublicos) throw new Error("respaldo desactivado");
  // La página de resultados viene en el cursor ("bs:2" = página 2).
  let pagina = 1;
  if (typeof cursor === "string" && cursor.indexOf("bs:") === 0) {
    const p = parseInt(cursor.slice(3), 10);
    if (p >= 1 && !isNaN(p)) pagina = p;
  }
  const lista = [];
  if (propio) lista.push({ base: propio, api: "invidious", propio: true });
  if (usarPublicos) {
    if (busquedaBuena) {
      const sep = busquedaBuena.indexOf("|");
      lista.push({ base: busquedaBuena.slice(0, sep), api: busquedaBuena.slice(sep + 1), propio: false });
    }
    for (let i = 0; i < POOL.length; i++) {
      const ent = POOL[(cursorBusqueda + i) % POOL.length];
      let repetido = false;
      for (let k = 0; k < lista.length; k++) {
        if (lista[k].base === ent.base && lista[k].api === ent.api) { repetido = true; break; }
      }
      if (!repetido) lista.push({ base: ent.base, api: ent.api, propio: false });
    }
  }
  const intentos = [];
  let probados = 0;
  for (let i = 0; i < lista.length && probados < 3; i++) {
    const ent = lista[i];
    const corto = ent.base.replace(/^https?:\/\//, "").replace(/\/$/, "");
    probados++;
    try {
      const items = await pedirBusqueda(ent, q, pagina, limite);
      busquedaBuena = ent.base + "|" + ent.api;
      trazaBusqueda = corto + " (" + ent.api + ", búsqueda liviana): " + items.length + " resultados";
      return { items: items, next: items.length > 0 ? "bs:" + (pagina + 1) : null };
    } catch (e) {
      intentos.push(corto + ": " + String(e && e.message ? e.message : e).slice(0, 50));
      if (!ent.propio) cursorBusqueda = (cursorBusqueda + 1) % POOL.length;
    }
  }
  trazaBusqueda = "respaldos cayeron: " + intentos.join("; ").slice(0, 120);
  throw new Error("búsqueda en respaldos: " + intentos.join("; ").slice(0, 120));
}

async function buscarVideos(query, cursor, limite) {
  // "bs:N" viene de una búsqueda liviana anterior: seguir en los respaldos.
  if (typeof cursor === "string" && cursor.indexOf("bs:") === 0) {
    return await buscarRespaldo(query, cursor, limite);
  }
  if (youtubeBuscable()) {
    try {
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
      rachaBusqMem = 0;
      trazaBusqueda = "YouTube directo (" + items.length + " resultados)";
      return { items: items, next: tokenDeContinuacion(j) };
    } catch (e) {
      if (modoBusqueda() === "no" || !esErrorMemoria(e)) throw e;
      notaBusqMemoria(e);
    }
  } else {
    trazaBusqueda = modoBusqueda() === "si"
      ? "Búsqueda liviana (Ajustes): respaldos"
      : "YouTube en reposo (memoria): respaldos";
  }
  return await buscarRespaldo(query, null, limite);
}

// El informe de diagnóstico como resultados de búsqueda: cada línea es un
// resultado, así el texto puede ser todo lo largo que necesite (el Estado de
// Ajustes se corta en 200 caracteres).
function informeDebug() {
  const lineas = [];
  lineas.push("TubeKino " + VERSION + " — informe técnico. (Estas líneas no se pueden reproducir.)");
  lineas.push("Config: método=" + String(kino.config.get("metodo") || "auto") +
    ", calidad=" + String(kino.config.get("calidad") || "mejor") +
    ", país=" + paisActual() +
    ", búsqueda=" + modoBusqueda());
  if (ultimoResolve) {
    lineas.push("Último video: vía=" + ultimoResolve.via +
      ", altura=" + ultimoResolve.altura +
      (ultimoResolve.hls ? ", HLS" : "") +
      (ultimoResolve.vivo ? ", en vivo" : ""));
  } else {
    lineas.push("Último video: (nada reproducido desde que se actualizó el plugin)");
  }
  lineas.push("Traza directo: " + (trazaDirecto || "(vacía: el directo aún no se ha probado)"));
  lineas.push("Relacionados (panel): " + (String(kino.config.get("relacionados") || "si").trim() !== "no"
    ? "activado; " + (ultimoRel && cacheRel[ultimoRel]
        ? cacheRel[ultimoRel].items.length + " parecidos del último video"
        : "aún sin datos")
    : "apagado en Ajustes"));
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
  lineas.push("Detalle navegador: " + (trazaNavegador || "(sin capturas todavía)"));
  lineas.push("Respaldos (forks): " + (trazaRespaldos || "(sin intentos todavía)"));
  lineas.push("Búsqueda: " + (trazaBusqueda || "(aún no se ha buscado)"));
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

// Entre páginas de la misma búsqueda no se repite nada: cuando Kino pide la
// siguiente página (el scroll llegó al fondo), aquí se recuerda lo ya visto.
var vistosBusq = { q: null, ids: null };
function paginaBusqueda(q, r) {
  if (vistosBusq.q !== q) vistosBusq = { q: q, ids: {} };
  const items = [];
  for (let i = 0; i < r.items.length; i++) {
    const it = r.items[i];
    if (it && it.id && !vistosBusq.ids[it.id]) {
      vistosBusq.ids[it.id] = 1;
      items.push(it);
    }
  }
  const pagina = { items: items };
  if (r.next && items.length > 0) pagina.next = r.next;
  return pagina;
}

export async function search(query) {
  const q = query && query.q ? String(query.q).trim() : "";
  const cursor = query && typeof query.cursor === "string" && query.cursor ? query.cursor : null;

  // Página siguiente de la misma búsqueda: al fondo del scroll, Kino la pide
  // con el cursor y la búsqueda sigue donde se quedó, página tras página.
  if (cursor) {
    try {
      return paginaBusqueda(q, await buscarVideos(q, cursor, 30));
    } catch (e) {
      // La continuación de YouTube es delicada: si falla, se sigue por los
      // respaldos en la página 2 de la misma búsqueda.
      return paginaBusqueda(q, await buscarRespaldo(q, "bs:2", 30));
    }
  }

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
  // Si la memoria no aguanta la respuesta de YouTube, los respaldos buscan
  // (sus respuestas son livianas); tras un rato sin revientes, YouTube vuelve.
  // La primera página trae su cursor: el scroll puede seguir pidiendo más.
  if (youtubeBuscable()) {
    try {
      const j = await innertube("search", ctxAndroid(), { query: q });
      let items = itemsDeRespuesta(j, 30);
      // La pantalla de búsqueda de Kino muestra una sola tanda: se traen dos
      // seguidas de YouTube para que el "más" ya esté a la vista.
      let tok = tokenDeContinuacion(j);
      if (items.length < 25 && tok) {
        try {
          const j2 = await innertube("search", ctxAndroid(), { continuation: tok });
          const mas = itemsDeRespuesta(j2, 40 - items.length);
          if (mas.length > 0) items = items.concat(mas);
          const tok2 = tokenDeContinuacion(j2);
          if (tok2) tok = tok2;
        } catch (e2) {
          // una tanda alcanza
        }
      }
      rachaBusqMem = 0;
      trazaBusqueda = "YouTube directo (" + items.length + " resultados)";
      return paginaBusqueda(q, { items: items, next: tok || "bs:2" });
    } catch (e) {
      if (modoBusqueda() === "no" || !esErrorMemoria(e)) throw e;
      notaBusqMemoria(e);
    }
  } else {
    trazaBusqueda = modoBusqueda() === "si"
      ? "Búsqueda liviana (Ajustes): respaldos"
      : "YouTube en reposo (memoria): respaldos";
  }
  // Respaldos: dos páginas de una vez para la misma pantalla.
  const r1 = await buscarRespaldo(q, null, 30);
  if (r1.items.length >= 15 && r1.next) {
    try {
      const r2 = await buscarRespaldo(q, r1.next, 30);
      if (r2.items.length > 0) {
        r1.items = r1.items.concat(r2.items);
        r1.next = r2.next || r1.next;
      }
    } catch (e2) {
      // una página alcanza
    }
  }
  return paginaBusqueda(q, r1);
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
  { id: "musica", title: "Conciertos y música", q: "concierto completo", genre: "musica" },
  { id: "juegos", title: "Videojuegos", q: "gameplay en español", genre: "entretenimiento" },
  { id: "android", title: "Android y celulares", q: "novedades android", genre: "otros" },
  { id: "sistemas", title: "Sistemas operativos", q: "novedades sistemas operativos", genre: "otros" },
  { id: "doramas", title: "Doramas", q: "dorama español latino capítulos", genre: "series" }
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

// Las categorías de la pestaña Categorías de Kino: al estilo de las pestañas
// de YouTube, cada una abre su "Ver más" con la cuadrícula paginada.
export async function categories() {
  return [
    { id: "cat.trailers", title: "Trailers de películas", ref: "search:trailer oficial película" },
    { id: "cat.musica", title: "Música", ref: "search:concierto completo" },
    { id: "cat.juegos", title: "Videojuegos", ref: "search:gameplay en español" },
    { id: "cat.android", title: "Android y celulares", ref: "search:novedades android" },
    { id: "cat.sistemas", title: "Sistemas operativos", ref: "search:novedades sistemas operativos" },
    { id: "cat.doramas", title: "Doramas", ref: "search:dorama español latino capítulos" }
  ];
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

// ---------- videos relacionados (el panel derecho de Kino) ----------

// Los "episodios" de un video suelto son los videos parecidos: el panel
// derecho los lista mientras se reproduce, como la barra lateral de YouTube.
// Se guardan cuando un respaldo ya trajo los datos del video (sin peticiones
// extra); si vienen fríos, se piden a Invidious una sola vez y se guardan.
var cacheRel = {};
var ultimoRel = "";

function guardarRel(videoId, lista, canal) {
  if (!lista || lista.length === 0) return;
  cacheRel[videoId] = { items: lista.slice(0, 19), t: Date.now(), canal: canal || null, conCanal: false };
  ultimoRel = videoId;
  const claves = Object.keys(cacheRel);
  if (claves.length > 12) {
    claves.sort(function (a, b) { return cacheRel[a].t - cacheRel[b].t; });
    while (claves.length > 12) delete cacheRel[claves.shift()];
  }
}

// Saca los recomendados de una respuesta de Invidious (recommendedVideos)
// o de Piped (relatedStreams).
function relDeRespuesta(j) {
  const fuera = [];
  const rec = j && Array.isArray(j.recommendedVideos) ? j.recommendedVideos : null;
  if (rec) {
    for (let i = 0; i < rec.length && fuera.length < 19; i++) {
      const r = rec[i] || {};
      if (!r.videoId || typeof r.title !== "string" || !r.title) continue;
      let still = "";
      const th = Array.isArray(r.videoThumbnails) ? r.videoThumbnails : [];
      for (let k = 0; k < th.length; k++) {
        if (th[k] && th[k].url && String(th[k].url).indexOf("https://") === 0) { still = th[k].url; break; }
      }
      fuera.push({
        id: String(r.videoId),
        title: r.title.slice(0, 90),
        still: still,
        min: r.lengthSeconds > 0 ? Math.round(r.lengthSeconds / 60) : 0
      });
    }
    return fuera;
  }
  const rel = j && Array.isArray(j.relatedStreams) ? j.relatedStreams : null;
  if (rel) {
    for (let i = 0; i < rel.length && fuera.length < 19; i++) {
      const r = rel[i] || {};
      const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(String(r.url || ""));
      if (!m || typeof r.title !== "string" || !r.title) continue;
      fuera.push({
        id: m[1],
        title: r.title.slice(0, 90),
        still: String(r.thumbnail || "").indexOf("https://") === 0 ? r.thumbnail : "",
        min: r.duration > 0 ? Math.round(r.duration / 60) : 0
      });
    }
  }
  return fuera;
}

// Lo último del canal que subió el video (Invidious lo llama authorId): detrás
// de los relacionados en el panel, como el "ir al canal" de YouTube.
async function videosDelCanal(authorId) {
  const propio = String(kino.config.get("servidor") || "").trim().replace(/\/+$/, "");
  const lista = [];
  if (propio) lista.push(propio);
  if (String(kino.config.get("respaldo") || "si").trim() !== "no") {
    for (let i = 0; i < POOL.length; i++) {
      const ent = POOL[(cursorRespaldos + i) % POOL.length];
      if (ent.api !== "invidious") continue;
      let repetido = false;
      for (let k = 0; k < lista.length; k++) {
        if (lista[k] === ent.base) { repetido = true; break; }
      }
      if (!repetido) lista.push(ent.base);
    }
  }
  for (let i = 0; i < lista.length && i < 3; i++) {
    try {
      const j = await fetchJson(lista[i] + "/api/v1/channels/" + authorId + "/videos?sort_by=newest", {
        method: "GET",
        headers: { "Accept": "application/json" },
        timeoutMs: 6000
      });
      const vids = Array.isArray(j && j.videos) ? j.videos
        : (Array.isArray(j && j.latestVideos) ? j.latestVideos : []);
      const fuera = [];
      for (let k = 0; k < vids.length && fuera.length < 6; k++) {
        const r = vids[k] || {};
        if (!r.videoId || typeof r.title !== "string" || !r.title) continue;
        let still = "";
        const th = Array.isArray(r.videoThumbnails) ? r.videoThumbnails : [];
        for (let m = 0; m < th.length; m++) {
          if (th[m] && th[m].url && String(th[m].url).indexOf("https://") === 0) { still = th[m].url; break; }
        }
        fuera.push({
          id: String(r.videoId),
          title: ("Canal: " + r.title).slice(0, 100),
          still: still,
          min: r.lengthSeconds > 0 ? Math.round(r.lengthSeconds / 60) : 0
        });
      }
      return fuera;
    } catch (e) {
      // siguiente servidor
    }
  }
  return [];
}

async function videosRelacionados(videoId) {
  let c = cacheRel[videoId];
  if (!c || Date.now() - c.t >= 900000) {
    const propio = String(kino.config.get("servidor") || "").trim().replace(/\/+$/, "");
    const lista = [];
    if (propio) lista.push(propio);
    if (String(kino.config.get("respaldo") || "si").trim() !== "no") {
      for (let i = 0; i < POOL.length; i++) {
        const ent = POOL[(cursorRespaldos + i) % POOL.length];
        if (ent.api !== "invidious") continue;
        let repetido = false;
        for (let k = 0; k < lista.length; k++) {
          if (lista[k] === ent.base) { repetido = true; break; }
        }
        if (!repetido) lista.push(ent.base);
      }
    }
    for (let i = 0; i < lista.length && i < 3; i++) {
      try {
        const j = await fetchJson(lista[i] + "/api/v1/videos/" + videoId, {
          method: "GET",
          headers: { "Accept": "application/json" },
          timeoutMs: 5000
        });
        if (j && typeof j.error === "string" && j.error) continue;
        const items = relDeRespuesta(j);
        if (items.length > 0) {
          const canal = j && typeof j.authorId === "string" && j.authorId ? j.authorId : null;
          guardarRel(videoId, items, canal);
          c = cacheRel[videoId];
          break;
        }
      } catch (e) {
        // siguiente servidor
      }
    }
  }
  if (!c) return [];
  // Una sola vez por vídeo: detrás de los relacionados va lo nuevo del canal.
  if (c.canal && !c.conCanal) {
    c.conCanal = true;
    try {
      const delCanal = await videosDelCanal(c.canal);
      for (let i = 0; i < delCanal.length; i++) {
        const d = delCanal[i];
        if (d.id === videoId) continue;
        let ya = false;
        for (let k = 0; k < c.items.length; k++) {
          if (c.items[k].id === d.id) { ya = true; break; }
        }
        if (!ya) c.items.push(d);
      }
    } catch (e) {
      // sin canal: los relacionados alcanzan
    }
  }
  return c.items;
}

export async function episodes(ref) {
  ref = String(ref || "");
  if (ref.indexOf("v:") === 0) {
    // El video mismo es el "episodio 1"; detrás van los parecidos, que
    // llenan el panel derecho mientras reproduce. Si algo falla, el video
    // solo, como siempre: nada de esto puede romper la reproducción.
    const epsVid = [{ number: 1, ref: ref }];
    if (String(kino.config.get("relacionados") || "si").trim() !== "no") {
      try {
        const rel = await videosRelacionados(ref.slice(2));
        for (let i = 0; i < rel.length; i++) {
          const ep = { number: i + 2, ref: "v:" + rel[i].id, title: rel[i].title };
          if (rel[i].still) ep.still = rel[i].still;
          if (rel[i].min > 0) ep.runtimeMinutes = rel[i].min;
          epsVid.push(ep);
        }
      } catch (e) {
        // sin panel: nada grave
      }
    }
    return { episodes: epsVid };
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
  242: 240, 243: 360, 244: 480, 245: 480, 246: 480, 247: 720, 248: 1080,
  271: 1440, 302: 720, 303: 1080, 308: 1440, 313: 2160, 315: 2160,
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
const ITAG_AUDIO = { 140: 4, 258: 3, 256: 2, 139: 1, 251: 2, 250: 2, 599: 2, 249: 1, 171: 1 };

// ¿Qué es una petición capturada del reproductor de la página: video, audio
// o nada? Mira el itag, luego el mime (campo o URL). Sin ninguna de las dos
// son los enlaces internos de SABR: solo sirven con peticiones POST que hace
// el reproductor web de YouTube, así que Kino no puede reproducirlos y NO se
// aceptan (aceptarlos da "video dañado").
function clasificaMedia(m) {
  const it = itagDeUrl(m.url);
  if (ITAG_AUDIO[it]) return "audio";
  if (ITAG_ALTURA[it]) return "video";
  if (m.mime && String(m.mime).indexOf("audio/") === 0) return "audio";
  if (m.mime && String(m.mime).indexOf("video/") === 0) return "video";
  if (/(mime=|mime%3D|mime\/)audio/i.test(m.url)) return "audio";
  if (/(mime=|mime%3D|mime\/)video/i.test(m.url)) return "video";
  return "";
}

function rangoAudioDeUrl(url) {
  const s = String(url);
  const m = s.match(/average_bitrate(?:=|\/)(\d+)/i) || s.match(/bitrate(?:=|\/)(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return (ITAG_AUDIO[itagDeUrl(s)] || 0) * 1000;
}

// Esperar entre reintentos. A prueba de entornos restringidos: si no hay
// setTimeout o lo rechaza, se sigue sin esperar (nunca revienta la vía).
function esperar(ms) {
  if (typeof setTimeout !== "function") return Promise.resolve();
  return new Promise(function (res) {
    try {
      setTimeout(res, ms);
    } catch (e) {
      res();
    }
  }).catch(function () { });
}

// Vía directa: pedir los formatos a Innertube como app oficial.
// Cada intento queda registrado en trazaClientes (visible con "debug"):
// es lo que nos dice QUÉ le respondió YouTube a cada cliente.
// Los subtítulos de un video de YouTube: los captions (manuales y
// automáticos) en formato VTT, para que el reproductor de Kino los tome.
// Manuales primero, español primero; a lo sumo 8 pistas.
function subsDeInnertube(j) {
  if (!j || !j.captions || !j.captions.playerCaptionsTracklistRenderer) return null;
  const tracks = j.captions.playerCaptionsTracklistRenderer.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const esp = function (t) { return String(t.languageCode || "").toLowerCase().indexOf("es") === 0; };
  const orden = tracks.slice(0);
  orden.sort(function (a, b) {
    const am = String(a.kind || "") === "asr" ? 1 : 0;
    const bm = String(b.kind || "") === "asr" ? 1 : 0;
    if (am !== bm) return am - bm;
    const ae = esp(a) ? 0 : 1;
    const be = esp(b) ? 0 : 1;
    if (ae !== be) return ae - be;
    return 0;
  });
  const subs = [];
  for (let i = 0; i < orden.length && subs.length < 8; i++) {
    const t = orden[i];
    if (!t || typeof t.baseUrl !== "string" || t.baseUrl.indexOf("http") !== 0) continue;
    const codigo = String(t.languageCode || "und").slice(0, 8) || "und";
    const url = t.baseUrl + (t.baseUrl.indexOf("fmt=") >= 0 ? "" : "&fmt=vtt");
    subs.push({ lang: codigo, url: url, format: "vtt" });
  }
  return subs.length > 0 ? subs : null;
}

// Lo mismo desde la respuesta de Invidious (j.captions) o de Piped
// (j.subtitles): los captions que ya traen sus /api/v1/videos y /api/streams.
function subsDeRespaldo(j, base) {
  const subs = [];
  const raiz = String(base || "").replace(/\/$/, "");
  const caps = j && Array.isArray(j.captions) ? j.captions : null;
  if (caps) {
    for (let i = 0; i < caps.length && subs.length < 8; i++) {
      const t = caps[i] || {};
      let url = String(t.url || "");
      if (!url) continue;
      if (url.indexOf("http") !== 0) url = raiz + (url.indexOf("/") === 0 ? url : "/" + url);
      if (url.indexOf("http") !== 0) continue;
      let codigo = String(t.language_code || t.languageCode || "").slice(0, 8);
      if (!codigo) codigo = /espa|spanish/i.test(String(t.label || "")) ? "es" : "und";
      subs.push({ lang: codigo, url: url, format: "vtt" });
    }
    return subs.length > 0 ? subs : null;
  }
  const pis = j && Array.isArray(j.subtitles) ? j.subtitles : null;
  if (pis) {
    for (let i = 0; i < pis.length && subs.length < 8; i++) {
      const t = pis[i] || {};
      let url = String(t.url || "");
      if (!url) continue;
      if (url.indexOf("http") !== 0) url = raiz + (url.indexOf("/") === 0 ? url : "/" + url);
      if (url.indexOf("http") !== 0) continue;
      if (/timedtext/.test(url) && url.indexOf("fmt=") < 0) url = url + "&fmt=vtt";
      const codigo = String(t.code || t.languageCode || "").slice(0, 8) || "und";
      subs.push({ lang: codigo, url: url, format: "vtt" });
    }
    if (subs.length > 0) return subs;
  }
  return null;
}

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
      const stHls = {
        url: sd.hlsManifestUrl,
        mime: "application/vnd.apple.mpegurl",
        headers: { "User-Agent": cx.client.userAgent },
        esVivo: !!(j.videoDetails && j.videoDetails.isLive === true)
      };
      const subsHls = subsDeInnertube(j);
      if (subsHls) stHls.subtitles = subsHls;
      return stHls;
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
      const subsSt = subsDeInnertube(j);
      if (subsSt) st.subtitles = subsSt;
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
  // Ninguna app dio calidad alta: pedirle a YouTube la página real del video
  // presentándonos como un Safari. Los Safari de verdad reciben un manifiesto
  // HLS (m3u8) con varias calidades, sin tokens (mismo mecanismo que yt-dlp).
  // El HLS llega por rachas (a veces la página viene sin él), así que se
  // reintenta un par de veces; si esta conexión lleva varios videos seguidos
  // sin HLS, un solo intento para no frenar cada reproducción.
  const intentosPagina = rachaPaginaSinHls >= 4 ? 1 : 3;
  let mejorPag = null;
  for (let intento = 1; intento <= intentosPagina; intento++) {
    try {
      const pag = await resolverPagina(videoId);
      if (pag.esHls) {
        rachaPaginaSinHls = 0;
        trazaClientes.push("PÁGINA (" + intento + "/" + intentosPagina + "): HLS ✓");
        trazaDirecto = "PÁGINA HLS";
        return pag.stream;
      }
      rachaPaginaSinHls++;
      trazaClientes.push("PÁGINA (" + intento + "/" + intentosPagina + "): " + pag.texto + " (sin HLS)");
      if (!mejorPag || (pag.altura || 0) > (mejorPag.altura || 0)) mejorPag = pag;
    } catch (e) {
      const men = String(e && e.message ? e.message : e).slice(0, 100);
      rachaPaginaSinHls++;
      trazaClientes.push("PÁGINA (" + intento + "/" + intentosPagina + "): " + men);
    }
    if (intento < intentosPagina) await esperar(1200);
  }
  if (mejorPag && (!mejor || (mejorPag.altura || 0) > mejor.altura)) {
    trazaDirecto = "PÁGINA " + mejorPag.texto;
    return mejorPag.stream;
  }
  // Nada superó lo que ya teníamos: nos quedamos con el mejor de los bajos.
  if (mejor) {
    trazaDirecto = mejor.traza;
    return mejor.stream;
  }
  trazaDirecto = "falla: " + detalle.slice(0, 80);
  const e = new Error("directo falló:" + detalle);
  e.esDirecto = true;
  throw e;
}

// Vía página: bajar la página del video como un Safari de verdad. La página
// trae su reproductor incrustado ("ytInitialPlayerResponse") con el HLS que
// YouTube le sirve a Safari (sin exigir tokens) y, a veces, formatos con
// enlace directo.
async function resolverPagina(videoId) {
  const ua = ctxWebSafari().client.userAgent;
  const r = await kino.fetch(
    "https://www.youtube.com/watch?v=" + videoId + "&hl=es-419&gl=" + paisActual(),
    {
      method: "GET",
      headers: { "User-Agent": ua, "Accept-Language": "es-419,es;q=0.8" },
      timeoutMs: 20000
    }
  );
  if (!r.ok) throw new Error("página http " + r.status);
  const html = await r.text();
  // El reproductor vive dentro de la página como JSON.
  const m = /ytInitialPlayerResponse\s*=\s*/.exec(html);
  if (!m) throw new Error("página sin reproductor (¿consentimiento?)");
  const ini = html.indexOf("{", m.index);
  if (ini < 0) throw new Error("reproductor sin JSON");
  // Extraer el JSON completo: contar llaves respetando las cadenas con
  // comillas y los escapes, hasta cerrar la llave que abrió.
  let prof = 0, fin = -1, enString = false, esc = false;
  for (let i = ini; i < html.length; i++) {
    const c = html.charAt(i);
    if (esc) { esc = false; continue; }
    if (enString) {
      if (c === "\\") esc = true;
      else if (c === '"') enString = false;
      continue;
    }
    if (c === '"') enString = true;
    else if (c === "{") prof++;
    else if (c === "}") { prof--; if (prof === 0) { fin = i; break; } }
  }
  if (fin < 0) throw new Error("reproductor cortado");
  let j = null;
  try { j = JSON.parse(html.slice(ini, fin + 1)); } catch (e2) { throw new Error("reproductor ilegible"); }
  const ps = j && j.playabilityStatus;
  if (!ps || ps.status !== "OK") {
    throw new Error("no jugable: " + String(ps && ps.reason ? ps.reason : ps ? ps.status : "sin estado"));
  }
  const sd = j.streamingData;
  if (!sd) throw new Error("sin streamingData");
  // HLS: varias calidades en un solo manifiesto, sin tokens.
  if (typeof sd.hlsManifestUrl === "string" && sd.hlsManifestUrl.indexOf("https://") === 0) {
    return {
      stream: {
        url: sd.hlsManifestUrl,
        mime: "application/vnd.apple.mpegurl",
        headers: { "User-Agent": ua },
        esVivo: !!(j.videoDetails && j.videoDetails.isLive === true)
      },
      texto: "HLS",
      esHls: true,
      altura: 720
    };
  }
  // Sin HLS, la página a veces trae formatos con enlace directo.
  const cap = capDeCalidad();
  const formats = Array.isArray(sd.formats) ? sd.formats : [];
  const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
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
  if (vids.length > 0 && auds.length > 0) {
    return {
      stream: {
        url: vids[0].url,
        mime: "video/mp4",
        headers: { "User-Agent": ua },
        audioTracks: [{ lang: "und", url: auds[0].url }]
      },
      texto: altura(vids[0]) + "p+audio",
      esHls: false,
      altura: altura(vids[0])
    };
  }
  for (let k = 0; k < formats.length; k++) {
    const f = formats[k];
    if (f && typeof f.url === "string" && f.url.indexOf("https://") === 0 &&
        String(f.mimeType || "").indexOf("video/") === 0 && tieneAudio(f) && altura(f) <= cap) {
      return {
        stream: { url: f.url, mime: "video/mp4", headers: { "User-Agent": ua } },
        texto: altura(f) + "p",
        esHls: false,
        altura: altura(f)
      };
    }
  }
  throw new Error("sin HLS ni enlaces en la página");
}

// ---------- respaldo: forks de YouTube operados por la comunidad ----------
// YouTube exige "tokens anti-bot" para dar más de 360p y en este aparato
// no se pueden generar. Los forks públicos sí resuelven esa parte en sus
// servidores y entregan un enlace listo. Hay dos familias, ambas libres:
// Invidious (lista oficial: docs.invidious.io/instances) y Piped (lista
// oficial: TeamPiped/documentation). Si un servidor falla se pasa al
// siguiente; el que funciona se recuerda para el próximo video, y con
// media hora sin fallos se olvida la racha (rotan sus IPs y se recuperan).
const RESPALDOS = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yt.chocolatemoo53.com",
  "https://invidious.tiekoetter.com",
  "https://invidious.f5.si"
];

const PIPEDS = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.drgns.space",
  "https://pipedapi.ducks.party",
  "https://api.piped.private.coffee",
  "https://pipedapi.leptons.xyz",
  "https://piped-api.privacy.com.de",
  "https://pipedapi.owo.si",
  "https://pipedapi.reallyaweso.me",
  "https://piped-api.codespace.cz",
  "https://pipedapi.darkness.services",
  "https://pipedapi.orangenet.cc",
  "https://pipedapi.nosebs.ru",
  "https://api.piped.yt",
  "https://pipedapi-libre.kavin.rocks"
];

// Un servidor de respaldo: base + qué API habla ("invidious" o "piped").
const POOL = [];
for (let i = 0; i < RESPALDOS.length; i++) POOL.push({ base: RESPALDOS[i], api: "invidious" });
for (let i = 0; i < PIPEDS.length; i++) POOL.push({ base: PIPEDS[i], api: "piped" });

let respaldoBueno = "";      // "base|api" del último servidor que funcionó
let cursorRespaldos = 0;     // por cuál del grupo vamos (rotar si van cayendo)
let rachaRespaldos = 0;      // intentos fallidos seguidos
let respaldoPausado = false; // con todas caídas, esperar un rato (no frenar la TV)
let ultimoFalloRespaldos = 0; // cuándo fue el último fallo (para reactivar)

// Altura de un formato de Invidious ("720p", "hd720", "1280x720"...).
function alturaEtiqueta(f) {
  if (f && typeof f.height === "number" && f.height > 0) return f.height;
  let m = String((f && f.qualityLabel) || "").match(/(\d{3,4})p?/i);
  if (m) return parseInt(m[1], 10);
  m = String((f && f.resolution) || "").match(/x(\d{3,4})/);
  if (m) return parseInt(m[1], 10);
  const q = String((f && f.quality) || "");
  if (q === "hd720") return 720;
  if (q === "medium") return 360;
  if (q === "small") return 240;
  return 0;
}

// Altura de un formato de Piped (quality: "1080p", o height).
function alturaPiped(s) {
  if (s && typeof s.height === "number" && s.height > 0) return s.height;
  const m = String((s && s.quality) || "").match(/(\d{3,4})p/i);
  return m ? parseInt(m[1], 10) : 0;
}

// Solo enlaces "locales" (la instancia hace de puente): los directos de
// googlevideo solo sirven desde la IP del servidor, no desde este aparato.
function esLocalUrl(u) {
  return typeof u === "string" && u.indexOf("http") === 0 && u.indexOf("googlevideo.com") < 0;
}

// Le pide el video a un servidor de respaldo (Invidious o Piped) y devuelve
// el mejor enlace que tenga.
async function pedirRespaldo(videoId, ent) {
  const ua = ctxWeb().client.userAgent;
  const cap = capDeCalidad();
  if (ent.api === "piped") {
    const j = await fetchJson(ent.base + "/api/streams/" + videoId, {
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": ua, "Accept-Language": "es-419,es;q=0.8" },
      timeoutMs: 6000
    });
    if (j && typeof j.error === "string" && j.error) throw new Error(String(j.error).slice(0, 60));
    try { guardarRel(videoId, relDeRespuesta(j), j && typeof j.authorId === "string" ? j.authorId : null); } catch (e2) {}
    if (j.liveStream === true && typeof j.hls === "string" && j.hls.indexOf("http") === 0) {
      return { stream: { url: j.hls, mime: "application/vnd.apple.mpegurl", esVivo: true }, altura: 0, vivo: true };
    }
    const vs = Array.isArray(j.videoStreams) ? j.videoStreams : [];
    const as = Array.isArray(j.audioStreams) ? j.audioStreams : [];
    let mux = null; // video+audio en el mismo archivo (itag 18/22, hasta 720p)
    let vid = null; // video solo (aquí vive la calidad alta)
    for (let k = 0; k < vs.length; k++) {
      const s = vs[k];
      if (!s || !esLocalUrl(s.url) || String(s.format || "") !== "MPEG_4") continue;
      const al = alturaPiped(s);
      if (al <= 0 || al > cap) continue;
      if (s.videoOnly === false) {
        if (!mux || al > mux.altura) mux = { url: s.url, altura: al, audio: null };
      } else if (!vid || al > vid.altura) vid = { url: s.url, altura: al };
    }
    let mejor = mux;
    if (vid && (!mejor || vid.altura > mejor.altura)) {
      let aud = null;
      for (let k = 0; k < as.length; k++) {
        const a = as[k];
        if (!a || !esLocalUrl(a.url) || String(a.format || "") !== "M4A") continue;
        if (!aud || (a.bitrate || 0) > (aud.bitrate || 0)) aud = a;
      }
      if (aud) mejor = { url: vid.url, altura: vid.altura, audio: aud.url };
    }
    if (mejor) {
      const st = { url: mejor.url, mime: "video/mp4" };
      if (mejor.audio) st.audioTracks = [{ lang: "und", url: mejor.audio }];
      const subsPiped = subsDeRespaldo(j, ent.base);
      if (subsPiped) st.subtitles = subsPiped;
      return { stream: st, altura: mejor.altura, vivo: false };
    }
    throw new Error("sin enlaces utilizables");
  }
  // Invidious.
  const j = await fetchJson(ent.base + "/api/v1/videos/" + videoId + "?local=true", {
    method: "GET",
    headers: { "Accept": "application/json", "User-Agent": ua, "Accept-Language": "es-419,es;q=0.8" },
    timeoutMs: 6000
  });
  if (j && typeof j.error === "string" && j.error) throw new Error(String(j.error).slice(0, 60));
  try { guardarRel(videoId, relDeRespuesta(j), j && typeof j.authorId === "string" ? j.authorId : null); } catch (e2) {}
  if (j.liveNow === true && typeof j.hlsUrl === "string" && j.hlsUrl.indexOf("http") === 0) {
    return { stream: { url: j.hlsUrl, mime: "application/vnd.apple.mpegurl", esVivo: true }, altura: 0, vivo: true };
  }
  const completos = [];
  const vids = [];
  const auds = [];
  const fs2 = Array.isArray(j.formatStreams) ? j.formatStreams : [];
  for (let k = 0; k < fs2.length; k++) {
    const f = fs2[k];
    if (!f || !esLocalUrl(f.url)) continue;
    if (String(f.type || "").indexOf("video/mp4") === 0 && alturaEtiqueta(f) > 0 && alturaEtiqueta(f) <= cap) completos.push(f);
  }
  const ads = Array.isArray(j.adaptiveFormats) ? j.adaptiveFormats : [];
  for (let k = 0; k < ads.length; k++) {
    const f = ads[k];
    if (!f || !esLocalUrl(f.url)) continue;
    const tipo = String(f.type || "");
    if (tipo.indexOf("video/mp4") === 0 && alturaEtiqueta(f) > 0 && alturaEtiqueta(f) <= cap) vids.push(f);
    else if (tipo.indexOf("audio/mp4") === 0) auds.push(f);
  }
  vids.sort(function (a, b) { return alturaEtiqueta(b) - alturaEtiqueta(a); });
  completos.sort(function (a, b) { return alturaEtiqueta(b) - alturaEtiqueta(a); });
  auds.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
  let st = null;
  let al = 0;
  if (completos.length > 0) {
    st = { url: completos[0].url, mime: "video/mp4" };
    al = alturaEtiqueta(completos[0]);
  }
  if (vids.length > 0 && auds.length > 0 && alturaEtiqueta(vids[0]) > al) {
    st = { url: vids[0].url, mime: "video/mp4", audioTracks: [{ lang: "und", url: auds[0].url }] };
    al = alturaEtiqueta(vids[0]);
  }
  if (st) {
    const subsInv = subsDeRespaldo(j, ent.base);
    if (subsInv) st.subtitles = subsInv;
    return { stream: st, altura: al, vivo: false };
  }
  throw new Error("sin enlaces utilizables");
}

// Pide el video al grupo de servidores y devuelve el mejor enlace que
// consigan entre todos.
async function resolverRespaldo(videoId) {
  const propio = String(kino.config.get("servidor") || "").trim().replace(/\/+$/, "");
  const usarPublicos = String(kino.config.get("respaldo") || "si").trim() !== "no";
  if (!propio && !usarPublicos) {
    trazaRespaldos = "(desactivado en Ajustes)";
    throw new Error("respaldo desactivado");
  }
  // Las instancias rotan sus IPs y se recuperan: con media hora sin tocar
  // este aparato, la racha se olvida y se vuelve a intentar con ganas.
  const ahora = Date.now();
  if (rachaRespaldos > 0 && ahora - ultimoFalloRespaldos > 1800000) {
    rachaRespaldos = 0;
    respaldoPausado = false;
  }
  if (respaldoPausado) {
    const falta = Math.max(1, Math.round((1800000 - (ahora - ultimoFalloRespaldos)) / 60000));
    trazaRespaldos = "en pausa: " + rachaRespaldos + " fallos seguidos (se reactiva en ~" + falta + " min)";
    throw new Error("respaldo en pausa");
  }
  const lista = [];
  if (propio) lista.push({ base: propio, api: "invidious", propio: true });
  if (usarPublicos) {
    if (respaldoBueno) {
      const sep = respaldoBueno.indexOf("|");
      lista.push({ base: respaldoBueno.slice(0, sep), api: respaldoBueno.slice(sep + 1), propio: false });
    }
    for (let i = 0; i < POOL.length; i++) {
      const ent = POOL[(cursorRespaldos + i) % POOL.length];
      let repetido = false;
      for (let k = 0; k < lista.length; k++) {
        if (lista[k].base === ent.base && lista[k].api === ent.api) { repetido = true; break; }
      }
      if (!repetido) lista.push({ base: ent.base, api: ent.api, propio: false });
    }
  }
  // Con fallas seguidas, menos intentos por video para no frenar el aparato.
  const maxIntentos = rachaRespaldos >= 16 ? 1 : rachaRespaldos >= 8 ? 2 : 3;
  const intentos = [];
  let probados = 0;
  for (let i = 0; i < lista.length && probados < maxIntentos; i++) {
    const ent = lista[i];
    const corto = ent.base.replace(/^https?:\/\//, "").replace(/\/$/, "");
    probados++;
    try {
      const r = await pedirRespaldo(videoId, ent);
      respaldoBueno = ent.base + "|" + ent.api;
      rachaRespaldos = 0;
      respaldoPausado = false;
      trazaRespaldos = corto + " (" + ent.api + "): " + (r.vivo ? "HLS en vivo" : r.altura + "p") + " ✓";
      ultimoRespaldo = { altura: r.altura, via: "respaldo", hls: !!r.vivo, vivo: !!r.vivo };
      return { stream: r.stream, altura: r.altura, instancia: corto, vivo: !!r.vivo };
    } catch (e) {
      intentos.push(corto + ": " + String(e && e.message ? e.message : e).slice(0, 50));
      rachaRespaldos++;
      ultimoFalloRespaldos = ahora;
      if (!ent.propio) cursorRespaldos = (cursorRespaldos + 1) % POOL.length;
      if (rachaRespaldos >= 24) respaldoPausado = true;
    }
  }
  trazaRespaldos = intentos.join("; ").slice(0, 600);
  throw new Error("respaldo: " + trazaRespaldos.slice(0, 100));
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

  // Qué vio el navegador (para el informe "debug").
  const itagsVistos = [];
  for (let i = 0; i < limpias.length; i++) {
    const it = itagDeUrl(limpias[i].url);
    if (it) itagsVistos.push(it);
  }
  trazaNavegador = "capturó " + limpias.length + "/" + crudos.length +
    (itagsVistos.length ? " peticiones; itags: " + itagsVistos.join(",") : " peticiones; sin itags") +
    (crudos.length > limpias.length ? " (anuncios descartados)" : "");

  // En vivo: manifiesto HLS.
  for (let i = 0; i < limpias.length; i++) {
    if (/\.m3u8/i.test(limpias[i].url)) {
      rachaNavegadorSabr = 0;
      trazaNavegador = trazaNavegador + "; HLS (en vivo)";
      const s = { url: limpias[i].url, mime: "application/vnd.apple.mpegurl", esVivo: true };
      if (limpias[i].headers) s.headers = limpias[i].headers;
      return s;
    }
  }

  // Video por un lado, audio por el otro (el reproductor de la página pide
  // las dos pistas por separado; Kino las une).
  const vids = [];
  const auds = [];
  for (let i = 0; i < limpias.length; i++) {
    const tipo = clasificaMedia(limpias[i]);
    if (tipo === "video") vids.push(limpias[i]);
    else if (tipo === "audio") auds.push(limpias[i]);
  }

  if (vids.length > 0) {
    rachaNavegadorSabr = 0;
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
    // Sin mp4 clásico, lo capturado vale como está (el reproductor de la
    // página eligió esa pista por algo).
    if (!principal) {
      vids.sort(function (a, b) { return alturaDeUrl(b.url) - alturaDeUrl(a.url); });
      principal = vids[0];
    }
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
    trazaNavegador = trazaNavegador + "; eligió " +
      (it ? "itag " + it : "pista sin itag") +
      (alturaDeUrl(principal.url) ? " " + alturaDeUrl(principal.url) + "p" : "") +
      (stream.audioTracks ? " + audio" : "");
    return stream;
  }

  // Nada utilizable: la captura trajo solo enlaces SABR (o nada). No se
  // devuelven: Kino no puede reproducirlos (daría "video dañado").
  rachaNavegadorSabr++;
  trazaNavegador = trazaNavegador + "; solo SABR (no reproducible)";
  throw kino.error("not_found", "captura sin enlaces utilizables (" + trazaNavegador.slice(0, 120) + ")", {
    userMessage: "El reproductor de YouTube solo entregó enlaces internos (SABR) que Kino no puede reproducir. Deja el método en Automático."
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

  // Automático: directo primero. Si quedó en calidad baja (menos de 720p),
  // los respaldos de la comunidad. El navegador oculto NO se abre aquí: en
  // este aparato la página nueva solo entrega enlaces SABR que no se pueden
  // reproducir, y su WebView es lo que más memoria consume (se abría en cada
  // video y dejaba el aparato sin memoria para el buscador). Solo se usa si
  // el directo falla del todo.
  if (reintento === 0) {
    let directo = null;
    let alturaDirecto = 0;
    try {
      directo = await resolverDirecto(videoId);
      alturaDirecto = ultimoDirecto ? ultimoDirecto.altura : 0;
    } catch (e) { /* a los respaldos */ }

    if (directo) {
      const vivo = String(directo.mime || "").indexOf("mpegurl") >= 0;
      if (!vivo && alturaDirecto > 0 && alturaDirecto < 720) {
        let txtRespaldo = "respaldo falló";
        try {
          const resp = await resolverRespaldo(videoId);
          if (resp.vivo || resp.altura > alturaDirecto) {
            ultimoResolve = ultimoRespaldo;
            return resp.stream;
          }
          txtRespaldo = "respaldo " + resp.altura + "p";
        } catch (e) { /* queda el directo en 360p */ }
        trazaDirecto = trazaDirecto + "; " + txtRespaldo;
      }
      ultimoResolve = ultimoDirecto;
      return directo;
    }
  }
  // El directo falló: los respaldos primero (hoy son más fiables que el
  // navegador oculto) y el navegador de última.
  try {
    const resp = await resolverRespaldo(videoId);
    ultimoResolve = ultimoRespaldo;
    return resp.stream;
  } catch (e) { /* al navegador */ }
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
  else texto = texto + " Auto: directo→respaldo→navegador.";
  texto = texto + " Calidad: " + calidad + ".";
  if (modoBusqueda() === "si") texto = texto + " Búsqueda liviana.";
  if (ultimoResolve) {
    if (ultimoResolve.vivo) texto = texto + " Último: en vivo.";
    else if (ultimoResolve.hls) texto = texto + " Último: HLS (" + ultimoResolve.via + ").";
    else if (ultimoResolve.altura > 0) {
      texto = texto + " Último: " + ultimoResolve.altura + "p (" + ultimoResolve.via + ").";
    }
  }
  // Los detalles técnicos (qué cliente sirvió el video, qué instancia cayó)
  // viven solo en el informe "debug": el Estado queda limpio, sin avisos de
  // error, como corresponde a un ajuste que ve cualquier usuario.
  return { estado: (texto + " Detalle: busca 'debug'.").slice(0, 200) };
    }
