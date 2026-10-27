// Internet Archive (archive.org): kamuya açık kayıtlar, konserler, eski albümler. Anahtarsız.
import { fetchJson, openHttpAudio } from "../../../core/http.js";
import { normalize } from "../match.js";

const AUDIO_FORMATS = ["VBR MP3", "MP3", "128Kbps MP3", "64Kbps MP3", "Ogg Vorbis", "Flac"];

const escape = (s) => String(s).replace(/[()":\\]/g, " ");

function identifierFrom(url) {
  return new URL(url).pathname.match(/^\/(details|download)\/([^/]+)/)?.[2] ?? null;
}

// Kayıttaki ses dosyalarından başlığa en uygununu seçer.
async function pickFile(identifier, wantedTitle) {
  const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const files = (meta.files ?? [])
    .filter((f) => AUDIO_FORMATS.includes(f.format))
    .sort((a, b) => AUDIO_FORMATS.indexOf(a.format) - AUDIO_FORMATS.indexOf(b.format));
  if (!files.length) throw new Error("archive.org kaydında ses dosyası yok");

  const wanted = normalize(wantedTitle);
  const file =
    (wanted ? files.find((f) => normalize(f.title ?? f.name).includes(wanted)) : null) ?? files[0];
  return {
    file,
    meta,
    url: `https://archive.org/download/${encodeURIComponent(identifier)}/${file.name
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  };
}

export default {
  id: "archive",
  name: "Internet Archive",
  matchesHost: (host) => /(^|\.)archive\.org$/.test(host),

  async search(query, limit, target) {
    const parts = target?.artist
      ? `title:(${escape(target.title)}) AND creator:(${escape(target.artist)})`
      : `(${escape(query)})`;
    const q = `${parts} AND mediatype:(audio)`;
    const res = await fetchJson(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
        `&fl[]=identifier&fl[]=title&fl[]=creator&rows=${limit}&output=json`,
      { timeoutMs: 15000 }
    );
    return (res.response?.docs ?? []).map((d) => ({
      id: d.identifier,
      title: d.title,
      artist: Array.isArray(d.creator) ? d.creator[0] : d.creator ?? null,
      duration: null,
      url: `https://archive.org/details/${d.identifier}`,
      wantedTitle: target?.title,
    }));
  },

  async fromUrl(url) {
    const id = identifierFrom(url);
    if (!id) throw new Error("archive.org linki tanınmadı");
    const { meta, file } = await pickFile(id, null);
    const m = meta.metadata ?? {};
    return {
      id,
      title: file.title ?? (Array.isArray(m.title) ? m.title[0] : m.title) ?? id,
      artist: file.creator ?? (Array.isArray(m.creator) ? m.creator[0] : m.creator) ?? null,
      duration: Number(file.length) || null,
      url,
    };
  },

  async open(track) {
    const { url } = await pickFile(track.id, track.wantedTitle);
    return openHttpAudio(url);
  },
};
