// Kullanıcının yazdığı link ya da aramayı, sırayla denenecek çalınabilir parçalara çevirir.
import { shortError } from "../../core/chat.js";
import { GOOD_MATCH, WEAK_MATCH, parseQuery, score, searchText } from "./match.js";
import { hasLinkMetadata, metadataFromLink, normalizeTarget } from "./metadata.js";
import { SEARCH_SOURCES, sourceForUrl } from "./sources/index.js";
import { openYtDlp, ytdlpInfo } from "./ytdlp.js";

const PER_SOURCE = 5;

export function isUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Hangi kaynağın neden başarısız olduğunu toplar; kanala kısa özet, loga ayrıntı gider.
export class Attempts {
  constructor() {
    this.bySource = new Map();
  }

  fail(source, reason, err) {
    this.bySource.set(source, reason);
    console.warn(`[müzik] ${source}: ${reason}${err ? " -> " + shortError(err) : ""}`);
  }

  summary() {
    return [...this.bySource].map(([s, r]) => `${s}: ${r}`).join(", ");
  }
}

function playable(source, track, extra = {}) {
  return {
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    url: track.url,
    sourceName: source.name,
    open: () => source.open(track),
    ...extra,
  };
}

// targets: önce resmî ad (Deezer), sonuç çıkmazsa kullanıcının yazdığı haliyle.
async function* searchSources(targets, attempts, skipId) {
  const weak = [];

  for (const source of SEARCH_SOURCES) {
    if (source.id === skipId) continue;

    let found = 0;
    let failed = false;
    let matched = false;
    for (const target of targets) {
      const query = searchText(target);
      let results;
      try {
        results = await source.search(query, PER_SOURCE, target);
      } catch (e) {
        attempts.fail(source.name, "ulaşılamadı", e);
        failed = true;
        break;
      }
      found += results.length;

      const ranked = results
        .map((track) => ({ track, s: score(track, target) }))
        .sort((a, b) => b.s - a.s);
      console.log(
        `[müzik] ${source.name} "${query}":`,
        ranked.slice(0, 3).map((r) => `${r.s.toFixed(2)} ${r.track.artist ?? "?"} - ${r.track.title}`)
      );

      weak.push(...ranked.filter((r) => r.s >= WEAK_MATCH && r.s < GOOD_MATCH).slice(0, 1).map((r) => ({ ...r, source })));

      const good = ranked.filter((r) => r.s >= GOOD_MATCH).slice(0, 2);
      if (good.length) {
        matched = true;
        for (const r of good) yield playable(source, r.track);
        break;
      }
    }
    if (!failed && !matched) attempts.fail(source.name, found ? "benzer şarkı yok" : "sonuç yok");
  }

  // Hiçbir yerde iyi eşleşme çıkmadıysa en yakın sonuçları son çare olarak dene.
  weak.sort((a, b) => b.s - a.s);
  for (const r of weak.slice(0, 2)) yield playable(r.source, r.track, { weak: true });
}

/**
 * Çalınabilir adayları sırayla üretir. Çağıran taraf her adayın open()'ını dener,
 * açılmazsa bir sonrakine geçer. Arama/link hiç çözülemezse attempts dolu kalır.
 */
export async function* findPlayable(input, attempts) {
  let target;
  let skipId = null;

  if (isUrl(input)) {
    const source = sourceForUrl(input);
    let direct = null;
    if (source) {
      try {
        direct = await source.fromUrl(input);
      } catch (e) {
        attempts.fail(source.name, "link açılamadı", e);
      }
      // 30 sn'lik önizlemeler (örn. SoundCloud Go+ şarkıları) çalınmaz, tam sürümü aranır.
      if (direct && direct.duration && direct.duration < 45) {
        attempts.fail(source.name, "sadece 30 sn önizleme var");
      } else if (direct) {
        yield playable(source, direct, { direct: true });
      }
      skipId = source.id;
    }

    const host = new URL(input).hostname.replace(/^www\./, "");
    let meta = null;
    try {
      meta = await metadataFromLink(input);
    } catch (e) {
      attempts.fail(host, shortError(e).slice(0, 80), e);
    }

    if (!meta && !source && !hasLinkMetadata(input)) {
      // Tanımadığımız bir site: yt-dlp'nin genel çözücüsüyle şansımızı deneriz.
      try {
        const track = await ytdlpInfo(input);
        yield playable({ name: host, open: () => openYtDlp(input) }, track, { direct: true });
      } catch (e) {
        attempts.fail(host, "bu site desteklenmiyor", e);
      }
      return;
    }
    // Link kendi kaynağında açılmadıysa başlığıyla diğer kaynaklarda ara.
    if (!meta && direct?.title) meta = parseQuery(direct.title, direct.artist);
    if (!meta) return;
    target = meta;
  } else {
    target = parseQuery(input);
  }

  const official = await normalizeTarget(target);
  console.log(`[müzik] hedef: ${official.artist ?? "?"} - ${official.title}${official.duration ? ` (${official.duration}s)` : ""}`);
  const targets = searchText(official) === searchText(target) ? [official] : [official, target];
  yield* searchSources(targets, attempts, skipId);
}
