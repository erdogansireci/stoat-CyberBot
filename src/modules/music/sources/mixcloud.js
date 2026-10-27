// Mixcloud: çoğunlukla DJ setleri ve uzun mixler. Anahtarsız arama API'si var.
import { fetchJson } from "../../../core/http.js";
import { openYtDlp, ytdlpInfo } from "../ytdlp.js";

export default {
  id: "mixcloud",
  name: "Mixcloud",
  matchesHost: (host) => /(^|\.)mixcloud\.com$/.test(host),

  async search(query, limit) {
    const res = await fetchJson(
      `https://api.mixcloud.com/search/?type=cloudcast&limit=${limit}&q=${encodeURIComponent(query)}`
    );
    return (res.data ?? []).map((c) => ({
      title: c.name,
      artist: c.user?.name ?? null,
      duration: c.audio_length || null,
      url: c.url,
    }));
  },

  fromUrl: (url) => ytdlpInfo(url),
  open: (track) => openYtDlp(track.url),
};
