// İnternet radyoları: Radio-Browser (https://www.radio-browser.info), ücretsiz ve anahtarsız.
import { fetchJson, openHttpAudio } from "../../core/http.js";
import { openYtDlp } from "./ytdlp.js";

const MIRRORS = ["de1", "de2", "fi1", "nl1"].map((m) => `https://${m}.api.radio-browser.info`);

async function api(path) {
  let lastErr;
  for (const base of MIRRORS) {
    try {
      return await fetchJson(`${base}${path}`, { timeoutMs: 8000 });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function query(params) {
  return new URLSearchParams({
    hidebroken: "true",
    order: "votes",
    reverse: "true",
    limit: "15",
    ...params,
  }).toString();
}

const CHECK_TIMEOUT_MS = 6000;

// HLS (.m3u8) yayınlar (Türk radyolarının çoğu) yt-dlp ile, diğerleri doğrudan açılır.
// HLS işaretli olmayıp HLS çalma listesi dönen istasyonlar da yt-dlp'ye düşer.
async function openStation(station, timeoutMs = 15000) {
  if (station.hls) return openYtDlp(station.url, { timeoutMs });
  try {
    return await openHttpAudio(station.url, { timeoutMs });
  } catch (e) {
    if (!String(e?.message).includes("HLS")) throw e;
    return openYtDlp(station.url, { timeoutMs });
  }
}

// Yayın gerçekten ses veriyor mu (ölü, web sayfası dönen ya da cevap vermeyen istasyonları eler).
async function isLive(station) {
  try {
    const h = await openStation(station, CHECK_TIMEOUT_MS);
    h.close();
    return true;
  } catch (e) {
    console.warn(`[radyo] açılmadı, listeden çıkarıldı: ${station.name} -> ${e?.message ?? e}`);
    return false;
  }
}

/**
 * Önce etikete (lofi, jazz, rock...), sonra istasyon adına göre arar; en çok oy alanlar önde.
 * İlk 2×limit istasyon aynı anda denenir, yayın verenlerden ilk `limit` tanesi döner.
 */
export async function searchStations(term, limit = 6) {
  const t = term.trim();
  const [byTag, byName] = await Promise.all([
    api(`/json/stations/search?${query({ tag: t.toLocaleLowerCase("tr") })}`).catch(() => []),
    api(`/json/stations/search?${query({ name: t })}`).catch(() => []),
  ]);

  const seen = new Set();
  const stations = [...byTag, ...byName]
    .filter((s) => s.url_resolved && !seen.has(s.stationuuid) && seen.add(s.stationuuid))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit * 2)
    .map((s) => ({
      id: s.stationuuid,
      name: s.name.trim(),
      country: s.countrycode || s.country || "",
      codec: s.codec,
      bitrate: s.bitrate,
      url: s.url_resolved,
      hls: !!s.hls,
    }));

  const live = await Promise.all(stations.map(isLive));
  return stations.filter((_, i) => live[i]).slice(0, limit);
}

export function describeStation(s) {
  const info = [s.country, s.bitrate ? `${s.bitrate}kbps` : null].filter(Boolean).join(", ");
  return info ? `${s.name} (${info})` : s.name;
}

// Kuyruğa girecek bir öğe üretir; ilk istasyon açılmazsa listedeki sonrakileri dener.
export function radioItem(stations, startIndex = 0) {
  const ordered = [...stations.slice(startIndex), ...stations.slice(0, startIndex)];
  return {
    input: ordered[0].name,
    title: ordered[0].name,
    isRadio: true,
    async *candidates() {
      for (const s of ordered) {
        yield {
          title: describeStation(s),
          sourceName: "Radyo",
          attemptName: s.name,
          isRadio: true,
          open: () => openStation(s),
        };
      }
    },
  };
}
