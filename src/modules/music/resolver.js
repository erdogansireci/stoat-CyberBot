// Kullanıcının yazdığı link ya da aramayı, sırayla denenecek çalınabilir parçalara çevirir.
import { shortError, withTimeout } from "../../core/chat.js";
import { GOOD_MATCH, WEAK_MATCH, normalize, parseQuery, score, searchText } from "./match.js";
import { hasLinkMetadata, metadataFromLink, normalizeTarget } from "./metadata.js";
import { SEARCH_SOURCES, sourceForUrl } from "./sources/index.js";
import { openYtDlp, ytdlpInfo } from "./ytdlp.js";

const PER_SOURCE = 6;
const SOURCE_TIMEOUT_MS = 10000;
const LIST_SIZE = 6;
const LIST_PER_SOURCE = 3;
const CHECK_POOL = 10; // listeden önce açılma kontrolü yapılan aday sayısı
const CHECK_TIMEOUT_MS = 6000;

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

// Tek kaynakta arar: önce resmî adla (Deezer), iyi sonuç çıkmazsa kullanıcının yazdığı haliyle.
async function searchOne(source, targets) {
  const out = [];
  for (const target of targets) {
    const results = await source.search(searchText(target), PER_SOURCE, target);
    for (const track of results) out.push({ track, s: score(track, target), source });
    if (out.some((r) => r.s >= GOOD_MATCH)) break;
  }
  return out;
}

/**
 * Tüm kaynaklarda aynı anda arar, sonuçları tek listede puana göre sıralar.
 * Eşit puanda MUSIC_SOURCES sırası öne geçer. Yavaş/kapalı kaynak en fazla 10 sn bekletir.
 */
async function rankAll(targets, attempts, skipId) {
  const sources = SEARCH_SOURCES.filter((s) => s.id !== skipId);
  const settled = await Promise.allSettled(
    sources.map((s) => withTimeout(searchOne(s, targets), SOURCE_TIMEOUT_MS, s.name))
  );

  const ranked = [];
  settled.forEach((res, i) => {
    const source = sources[i];
    if (res.status === "rejected") return attempts.fail(source.name, "ulaşılamadı", res.reason);
    if (!res.value.length) return attempts.fail(source.name, "sonuç yok");
    if (!res.value.some((r) => r.s >= WEAK_MATCH)) attempts.fail(source.name, "benzer şarkı yok");
    ranked.push(...res.value.map((r) => ({ ...r, order: i })));
  });

  // Aynı kayıt iki sorguda da gelmiş olabilir; aynı kaynakta aynı ad+sanatçı bir kez sayılır.
  const seen = new Set();
  const unique = ranked
    .sort((a, b) => b.s - a.s || a.order - b.order)
    .filter((r) => {
      const key = `${r.source.id}|${normalize(r.track.title)}|${normalize(r.track.artist)}`;
      if (seen.has(r.track.url) || seen.has(key)) return false;
      seen.add(r.track.url).add(key);
      return true;
    });

  console.log(
    `[müzik] sıralama "${searchText(targets[0])}":`,
    unique.slice(0, 5).map((r) => `${r.s.toFixed(2)} ${r.source.name}: ${r.track.artist ?? "?"} - ${r.track.title}`)
  );
  return unique;
}

async function* searchSources(targets, attempts, skipId) {
  const ranked = await rankAll(targets, attempts, skipId);
  for (const r of ranked.filter((r) => r.s >= GOOD_MATCH).slice(0, 6)) yield playable(r.source, r.track);
  // Hiçbir yerde iyi eşleşme çıkmadıysa en yakın sonuçları son çare olarak dene.
  for (const r of ranked.filter((r) => r.s >= WEAK_MATCH && r.s < GOOD_MATCH).slice(0, 3)) {
    yield playable(r.source, r.track, { weak: true });
  }
}

async function targetsFor(target) {
  const official = await normalizeTarget(target);
  console.log(`[müzik] hedef: ${official.artist ?? "?"} - ${official.title}${official.duration ? ` (${official.duration}s)` : ""}`);
  return searchText(official) === searchText(target) ? [official] : [official, target];
}

// Adayın sesi gerçekten açılıyor mu (kısıtlı, satın alınmalı, bölge engelli kayıtları eler).
async function canOpen(p) {
  const pending = p.open();
  try {
    const handle = await withTimeout(pending, CHECK_TIMEOUT_MS, "kontrol");
    handle.close();
    return true;
  } catch (e) {
    // Zaman aşımından sonra açılırsa sızmasın.
    pending.then((h) => h.close(), () => {});
    console.warn(`[liste] açılamadı, listeden çıkarıldı: ${p.sourceName} "${p.title}" -> ${shortError(e)}`);
    return false;
  }
}

/**
 * !play list için en iyi sonuçlar. Seçim önceliği: çeşitlilik (aynı kaynaktan en fazla 3)
 * ve iyi eşleşmeler; sonra aynı kaynaktan fazlası ve yakın eşleşmeler. En iyi
 * CHECK_POOL aday aynı anda açılmayı dener, açılabilen ilk `limit` tanesi listelenir.
 */
export async function searchList(query, attempts, limit = LIST_SIZE) {
  const ranked = (await rankAll(await targetsFor(parseQuery(query)), attempts, null))
    .filter((r) => r.s >= WEAK_MATCH);
  const pool = [];
  const perSource = new Map();

  const passes = [
    (r) => r.s >= GOOD_MATCH && (perSource.get(r.source.id) ?? 0) < LIST_PER_SOURCE,
    (r) => r.s >= GOOD_MATCH,
    () => true,
  ];
  for (const ok of passes) {
    for (const r of ranked) {
      if (pool.length >= CHECK_POOL) break;
      if (!pool.includes(r) && ok(r)) {
        pool.push(r);
        perSource.set(r.source.id, (perSource.get(r.source.id) ?? 0) + 1);
      }
    }
  }

  // Hepsi aynı anda denenir; öncelik sırasıyla `limit` tanesi kesinleşince geri kalan beklenmez.
  const items = pool.map((r) => playable(r.source, r.track, { weak: r.s < GOOD_MATCH }));
  const checks = items.map(canOpen);
  const chosen = [];
  for (let i = 0; i < pool.length && chosen.length < limit; i++) {
    if (await checks[i]) chosen.push(pool[i]);
  }

  // Seçim önceliğine göre alınanlar listede puan sırasıyla gösterilir.
  return ranked
    .filter((r) => chosen.includes(r))
    .map((r) => items[pool.indexOf(r)]);
}

/**
 * Çalınabilir adayları sırayla üretir. Çağıran taraf her adayın open()'ını dener,
 * açılmazsa bir sonrakine geçer. Arama/link hiç çözülemezse attempts dolu kalır.
 */
export async function* findPlayable(input, attempts) {
  let target;
  let skipId = null;

  if (isUrl(input)) {
    // Mixcloud kayıtları neredeyse hep lisans kısıtlı; genel çözücüyle de denenmez.
    if (/(^|\.)mixcloud\.com$/i.test(new URL(input).hostname)) {
      attempts.fail("Mixcloud", "desteklenmiyor");
      return;
    }
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

  yield* searchSources(await targetsFor(target), attempts, skipId);
}
