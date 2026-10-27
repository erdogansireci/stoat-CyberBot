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

// Doğrudan ses dosyası/yayını açar. Dönen handle.close() bağlantıyı keser.
export async function openHttpAudio(url, { timeoutMs = 15000 } = {}) {
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
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  if (type.includes("text/html")) {
    controller.abort();
    throw new Error(`ses değil (${type})`);
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
