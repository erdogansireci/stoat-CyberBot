import { Readable } from "node:stream";
import { config } from "../config.js";

const USER_AGENT = `${config.appName}/2.0 (Stoat music bot)`;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function request(url, { timeoutMs = 10000, browser = false, ...init } = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: { "User-Agent": browser ? BROWSER_UA : USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res;
}

export async function fetchJson(url, opts) {
  return (await request(url, opts)).json();
}

export async function fetchText(url, opts) {
  return (await request(url, opts)).text();
}

// Kısa linklerin (örn. link.deezer.com) gittiği son adresi döner.
export async function finalUrl(url) {
  const res = await request(url, { browser: true });
  res.body?.cancel().catch(() => {});
  return res.url;
}

const PLAYLIST_TYPE = /mpegurl|x-scpls|audio\/x-pls|\bm3u\b/i;

// .m3u / .pls çalma listesinin içindeki ilk ses adresi (radyolarda sık görülür).
function firstPlaylistUrl(text) {
  if (text.includes("#EXT-X-")) throw new Error("HLS yayını desteklenmiyor");
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(?:File\d+=)?(https?:\/\/\S+)/i);
    if (m) return m[1];
  }
  throw new Error("çalma listesinde adres yok");
}

// Doğrudan ses dosyası/yayını açar. Dönen handle.close() bağlantıyı keser.
// Çalma listesi (.m3u/.pls) dönerse içindeki adres açılır.
export async function openHttpAudio(url, { timeoutMs = 15000, depth = 0 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA, Accept: "*/*" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body) {
    controller.abort();
    throw new Error(`HTTP ${res.status}`);
  }
  if (type.includes("text/html")) {
    controller.abort();
    throw new Error(`ses değil (${type})`);
  }
  if (PLAYLIST_TYPE.test(type) || /\.(m3u|pls)(\?|$)/i.test(new URL(res.url).pathname)) {
    if (depth >= 2) throw new Error("iç içe çalma listesi");
    const text = (await res.text()).slice(0, 20000);
    return openHttpAudio(firstPlaylistUrl(text), { timeoutMs, depth: depth + 1 });
  }

  const stream = Readable.fromWeb(res.body);
  stream.on("error", () => {});
  return {
    stream,
    close: () => {
      controller.abort();
      stream.destroy();
    },
  };
}
