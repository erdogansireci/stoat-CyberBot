// Başlık temizleme, "Sanatçı - Şarkı" ayırma ve arama sonuçlarını puanlama.

// Parantez içinde bunlardan biri geçiyorsa o parantez tamamen atılır.
const NOISE_IN_BRACKETS =
  /\b(official|video|audio|lyrics?|lyric video|visuali[sz]er|hd|hq|4k|8k|remaster(ed)?|radio edit|clip|explicit|clean|m\/?v|music video|full version|extended|original mix|feat\.?|ft\.?|prod\.?|with|sözleri|klip|resmi)\b/i;

// Başlığın sonundaki "| Official Video", "// HD" gibi ekler.
const TRAILING_NOISE = /\s+(\||\/\/|–|—)\s+.*$/;
const FEAT = /\s+(feat\.?|ft\.?|featuring|prod\.?)\s+.*$/i;

// Sorguda yoksa sonucun puanını düşüren kelimeler (yanlış versiyonlar).
const BAD_VERSIONS = [
  "remix", "cover", "karaoke", "nightcore", "sped up", "speed up", "slowed", "reverb",
  "mashup", "mash up", "rework", "bootleg", "instrumental", "midi", "8d", "live",
  "acoustic", "tribute", "type beat", "flip", "vip", "edit", "piano", "lofi", "lo-fi",
  "loop", "extended", "megamix", "medley", "parody", "reaction", "tutorial",
];

// Metinde geçen versiyon kelimeleri (remix, live, cover...).
export function versionWords(text) {
  const t = normalize(text).replace(/\bradio edit\b/g, "");
  return BAD_VERSIONS.filter((w) => new RegExp(`\\b${normalize(w)}\\b`).test(t));
}

export function normalize(text) {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const tokens = (text) => normalize(text).split(" ").filter(Boolean);
const compact = (text) => normalize(text).replace(/ /g, "");

export function cleanTitle(title) {
  let t = String(title ?? "");
  t = t.replace(/[\(\[\{【]([^\)\]\}】]*)[\)\]\}】]/g, (all, inner) =>
    NOISE_IN_BRACKETS.test(inner) ? " " : ` ${inner} `
  );
  t = t.replace(TRAILING_NOISE, "");
  t = t.replace(FEAT, "");
  t = t.replace(/\s*#\S+/g, "");
  t = t.replace(/["“”]/g, "");
  return t.replace(/\s+/g, " ").trim();
}

export function cleanArtist(artist) {
  return String(artist ?? "")
    .replace(/\s*-\s*topic$/i, "")
    .replace(/vevo$/i, "")
    .replace(/\s*(official|resmi)(\s+(channel|kanal[ıi]?))?$/i, "")
    .trim() || null;
}

/**
 * Serbest metni ya da bir video başlığını { artist, title } hedefine çevirir.
 * "Daft Punk - Around The World (Official Video)" -> { artist: "Daft Punk", title: "Around The World" }
 */
export function parseQuery(text, fallbackArtist = null) {
  const cleaned = cleanTitle(text);
  const m = cleaned.match(/^(.+?)\s+[-–—~]\s+(.+)$/);
  if (m) return { artist: cleanTitle(m[1]), title: cleanTitle(m[2]), raw: text };
  return { artist: cleanArtist(fallbackArtist), title: cleaned, raw: text };
}

export function searchText(target) {
  return [target.artist, target.title].filter(Boolean).join(" ");
}

function coverage(needle, haystackTokens, haystackCompact) {
  const n = tokens(needle);
  if (!n.length) return 0;
  if (haystackCompact.includes(compact(needle))) return 1;
  const hits = n.filter((t) => haystackTokens.includes(t)).length;
  return hits / n.length;
}

/**
 * Bir arama sonucunun hedefle ne kadar örtüştüğünü 0..1 arası puanlar.
 * candidate: { title, artist, duration }, target: { artist, title, duration, raw }
 */
export function score(candidate, target) {
  const full = `${candidate.title ?? ""} ${candidate.artist ?? ""}`;
  const fullTokens = tokens(full);
  const fullCompact = compact(full);

  const titleScore = coverage(target.title, fullTokens, fullCompact);
  let s = titleScore;
  if (target.artist) {
    const artistScore = coverage(target.artist, fullTokens, fullCompact);
    s = 0.65 * titleScore + 0.35 * artistScore;
    // Resmî yükleme: yükleyen hesap sanatçının kendisi.
    const uploader = cleanArtist(candidate.artist);
    if (uploader && compact(uploader) === compact(target.artist)) s += 0.1;
  }

  // İstenmeyen versiyonlar (remix, cover, live...) sorguda yoksa ceza.
  const wanted = `${target.raw ?? ""} ${target.title} ${target.artist ?? ""}`;
  const wantedVersions = versionWords(wanted);
  const unwanted = versionWords(candidate.title).filter((w) => !wantedVersions.includes(w));
  s -= Math.min(unwanted.length * 0.4, 0.5);

  // Hedefte olmayan fazladan kelimeler için hafif ceza.
  const targetTokens = new Set(tokens(`${target.title} ${target.artist ?? ""}`));
  const extra = tokens(cleanTitle(candidate.title)).filter((t) => !targetTokens.has(t)).length;
  s -= Math.min(extra * 0.02, 0.1);

  // Süre: 30 sn'lik önizlemeler elenir. Aynı şarkının albüm/klip versiyonları farklı
  // uzunlukta olabildiği için süre farkına sadece hafif ceza verilir.
  const cd = candidate.duration;
  const known = (target.durations?.length ? target.durations : [target.duration]).filter(Boolean);
  // Adayın süresine en yakın geçerli sürüm referans alınır.
  const td = cd && known.length
    ? known.reduce((a, b) => (Math.abs(b - cd) < Math.abs(a - cd) ? b : a))
    : known[0];
  if (cd && cd < 45 && !(td && td < 60)) s -= 0.5;
  // Süresi bilinmeyen sonuçlar (Bandcamp, Archive) doğrulanmış olanların önüne geçmesin.
  if (!cd && td) s -= 0.05;
  if (cd && td) {
    const diff = Math.abs(cd - td);
    if (diff <= 10) s += 0.05;
    else if (cd > td * 2.5) s -= 0.4; // uzun DJ mixleri / albümün tamamı
    else if (diff > td * 0.5) s -= 0.15;
    else if (diff > 30) s -= 0.05;
  }

  // Üstten kırpılmaz ki resmî yükleme bonusu eşit puanlılar arasında fark yaratsın.
  return Math.max(0, s);
}

// Başlık zaten "Sanatçı - Şarkı" ise yükleyen adını ekleme; "(Official Video)" gibi ekleri at.
export function displayTitle(track) {
  if (track.isRadio) return track.title;
  const title = cleanTitle(track.title);
  if (!title) return null;
  if (!track.artist || /\s[-–—]\s/.test(title) || title.toLowerCase().includes(track.artist.toLowerCase())) {
    return title;
  }
  return `${track.artist} - ${title}`;
}

export function formatDuration(sec) {
  if (!sec) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const GOOD_MATCH = 0.6;
export const WEAK_MATCH = 0.4;
