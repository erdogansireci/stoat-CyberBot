// Bandcamp: resmî arama API'si yok; sitenin kendi arama kutusunun kullandığı uç kullanılıyor.
// Site bunu değiştirirse arama bozulabilir, linkler yt-dlp ile çalışmaya devam eder.
import { fetchJson } from "../../../core/http.js";
import { openYtDlp, ytdlpInfo } from "../ytdlp.js";

const SEARCH_URL = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic";

export default {
  id: "bandcamp",
  name: "Bandcamp",
  matchesHost: (host) => /(^|\.)bandcamp\.com$/.test(host),

  async search(query, limit) {
    const res = await fetchJson(SEARCH_URL, {
      method: "POST",
      browser: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search_text: query, search_filter: "t", full_page: false, fan_id: null }),
    });
    return (res.auto?.results ?? [])
      .filter((r) => r.type === "t" && r.item_url_path)
      .slice(0, limit)
      .map((r) => ({ title: r.name, artist: r.band_name, duration: null, url: r.item_url_path }));
  },

  fromUrl: (url) => ytdlpInfo(url),
  open: (track) => openYtDlp(track.url),
};
