// İnternet radyoları: Radio-Browser (https://www.radio-browser.info), ücretsiz ve anahtarsız.
import { fetchJson, openHttpAudio } from "../../core/http.js";

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

/** Önce etikete (lofi, jazz, rock...), sonra istasyon adına göre arar; en çok oy alanlar önde. */
export async function searchStations(term, limit = 5) {
  const t = term.trim();
  const [byTag, byName] = await Promise.all([
    api(`/json/stations/search?${query({ tag: t.toLocaleLowerCase("tr") })}`).catch(() => []),
    api(`/json/stations/search?${query({ name: t })}`).catch(() => []),
  ]);

  const seen = new Set();
  return [...byTag, ...byName]
    .filter((s) => s.url_resolved && !s.hls && !seen.has(s.stationuuid) && seen.add(s.stationuuid))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit)
    .map((s) => ({
      id: s.stationuuid,
      name: s.name.trim(),
      country: s.countrycode || s.country || "",
      codec: s.codec,
      bitrate: s.bitrate,
      url: s.url_resolved,
    }));
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
          open: () => openHttpAudio(s.url),
        };
      }
    },
  };
}
