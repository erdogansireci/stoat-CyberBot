// Yeni bir kaynak eklemek için: bu klasöre { id, name, matchesHost, search, fromUrl, open }
// şeklinde bir dosya yazıp aşağıdaki listeye ekleyin.
import { config } from "../../../config.js";
import soundcloud from "./soundcloud.js";
import audius from "./audius.js";
import bandcamp from "./bandcamp.js";
import mixcloud from "./mixcloud.js";
import archive from "./archive.js";
import youtube from "./youtube.js";

export const ALL_SOURCES = [soundcloud, audius, bandcamp, mixcloud, archive, youtube];

// Kelime aramasında aranan kaynaklar (MUSIC_SOURCES sırası eşit puanda öncelik verir).
export const SEARCH_SOURCES = config.musicSources
  .map((id) => ALL_SOURCES.find((s) => s.id === id))
  .filter(Boolean);

// Linkler, aramada kapalı olsa bile tanınan tüm kaynaklarda çalışır.
export function sourceForUrl(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return ALL_SOURCES.find((s) => s.matchesHost(host)) ?? null;
}
