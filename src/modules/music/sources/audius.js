// Audius: ücretsiz, anahtarsız açık müzik platformu (https://api.audius.co).
import { config } from "../../../config.js";
import { fetchJson, openHttpAudio } from "../../../core/http.js";

const API = "https://api.audius.co/v1";
const app = () => `app_name=${encodeURIComponent(config.appName)}`;

function toTrack(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.user?.name ?? null,
    duration: t.duration || null,
    url: `https://audius.co${t.permalink}`,
  };
}

export default {
  id: "audius",
  name: "Audius",
  matchesHost: (host) => /(^|\.)audius\.co$/.test(host),

  async search(query, limit) {
    const res = await fetchJson(
      `${API}/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&${app()}`
    );
    return (res.data ?? []).filter((t) => t.is_streamable !== false).map(toTrack);
  },

  async fromUrl(url) {
    const res = await fetchJson(`${API}/resolve?url=${encodeURIComponent(url)}&${app()}`);
    const t = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!t?.id || !t.title) throw new Error("Audius linki bir şarkı değil");
    return toTrack(t);
  },

  open: (track) => openHttpAudio(`${API}/tracks/${track.id}/stream?${app()}`),
};
