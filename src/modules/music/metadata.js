// Şarkının "resmî" adını bulmak ve çalınamayan linklerden (Spotify, Deezer, Apple Music,
// YouTube) sanatçı + şarkı adı çıkarmak için anahtarsız servisler.
import { fetchJson, fetchText, finalUrl } from "../../core/http.js";
import { shortError } from "../../core/chat.js";
import { cleanArtist, cleanTitle, normalize, parseQuery, score, versionWords } from "./match.js";

const DEEZER_MATCH = 0.7;
// Sanatçı yazılmamış aramalarda sadece bilinen (popüler) şarkılar kabul edilir.
const DEEZER_POPULAR_RANK = 400000;

function acceptDeezer(t, target) {
  // "live", "remix" gibi istenen versiyon resmî adda yoksa normalleştirme versiyonu kaybettirir.
  const wanted = versionWords(target.raw ?? target.title);
  const got = versionWords(t.title);
  if (wanted.some((w) => !got.includes(w))) return false;
  if (target.artist) return true;
  const artist = normalize(t.artist?.name);
  const queryHasArtist = !!artist && normalize(target.raw ?? target.title).includes(artist);
  return queryHasArtist || (t.rank ?? 0) >= DEEZER_POPULAR_RANK;
}

function fromDeezerTrack(t) {
  return {
    artist: t.artist?.name ?? null,
    // title_short "(Live)" gibi versiyon bilgisini atıyor; cleanTitle sadece gürültüyü temizler.
    title: cleanTitle(t.title ?? t.title_short),
    duration: t.duration || null,
  };
}

/**
 * Hedefi Deezer kataloğuyla doğrular. Eşleşme iyi ise resmî sanatçı/ad/süreyi kullanır,
 * değilse hedefi olduğu gibi bırakır. Deezer'dan ses çalınmaz, sadece isim için kullanılır.
 */
export async function normalizeTarget(target) {
  const queries = [];
  if (target.artist) queries.push(`artist:"${target.artist}" track:"${target.title}"`);
  queries.push([target.artist, target.title].filter(Boolean).join(" "));

  for (const q of queries) {
    try {
      const res = await fetchJson(`https://api.deezer.com/search?limit=5&q=${encodeURIComponent(q)}`);
      const ranked = (res.data ?? [])
        .map((t) => ({ t, s: score({ title: t.title, artist: t.artist?.name, duration: t.duration }, target) }))
        .sort((a, b) => b.s - a.s);
      const best = ranked.find((r) => r.s >= DEEZER_MATCH && acceptDeezer(r.t, target));
      if (best) return { ...target, ...fromDeezerTrack(best.t), raw: target.raw };
    } catch (e) {
      console.warn("[deezer]", shortError(e));
      break;
    }
  }
  return target;
}

async function youtubeMeta(url) {
  const res = await fetchJson(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
  );
  return parseQuery(res.title, res.author_name);
}

async function spotifyMeta(url) {
  if (!/\/track\//.test(url)) throw new Error("Spotify'da sadece şarkı linkleri destekleniyor");
  // Tarayıcı kimliğiyle gelince Spotify og etiketsiz uygulama sayfası döndürüyor.
  const html = await fetchText(url);
  const meta = (prop) =>
    html.match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`))?.[1] ?? null;
  const title = meta("title");
  const artist = meta("description")?.split(" · ")[0] ?? null;
  if (!title) throw new Error("Spotify başlığı okunamadı");
  return { artist: decodeHtml(artist), title: cleanTitle(decodeHtml(title)), raw: title };
}

async function deezerMeta(url) {
  let u = url;
  if (!/\/track\/\d+/.test(u)) u = await finalUrl(u); // link.deezer.com kısa linkleri
  const id = u.match(/\/track\/(\d+)/)?.[1];
  if (!id) throw new Error("Deezer'da sadece şarkı linkleri destekleniyor");
  const t = await fetchJson(`https://api.deezer.com/track/${id}`);
  if (t.error) throw new Error(t.error.message);
  return { ...fromDeezerTrack(t), raw: t.title };
}

async function appleMeta(url) {
  const u = new URL(url);
  const id = u.searchParams.get("i") ?? (u.pathname.includes("/song/") ? u.pathname.split("/").pop() : null);
  if (!id) throw new Error("Apple Music'te sadece şarkı linkleri destekleniyor");
  const res = await fetchJson(`https://itunes.apple.com/lookup?id=${id}`);
  const t = res.results?.find((x) => x.kind === "song") ?? res.results?.[0];
  if (!t) throw new Error("Apple Music şarkısı bulunamadı");
  return {
    artist: t.artistName,
    title: cleanTitle(t.trackName),
    duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
    raw: t.trackName,
  };
}

function decodeHtml(s) {
  return s
    ?.replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

// Kendisi çalınamayan ama içinden şarkı adı çıkarılabilen link türleri.
export const LINK_METADATA = [
  { name: "YouTube", match: (h) => /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(h), get: youtubeMeta },
  { name: "Spotify", match: (h) => h === "open.spotify.com", get: spotifyMeta },
  { name: "Deezer", match: (h) => /(^|\.)deezer\.(com|page\.link)$/.test(h), get: deezerMeta },
  { name: "Apple Music", match: (h) => /^(music|itunes)\.apple\.com$/.test(h), get: appleMeta },
];

function providerFor(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return LINK_METADATA.find((p) => p.match(host)) ?? null;
}

export const hasLinkMetadata = (url) => !!providerFor(url);

export async function metadataFromLink(url) {
  const provider = providerFor(url);
  if (!provider) return null;
  const meta = await provider.get(url);
  return { ...meta, artist: cleanArtist(meta.artist), via: provider.name };
}
