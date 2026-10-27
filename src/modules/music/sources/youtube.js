// YouTube sunucu IP'sini engellediği için varsayılan olarak kapalı.
// Açmak için MUSIC_SOURCES'a "youtube" ekleyin; gerekirse YTDLP_COOKIES ile cookie dosyası verin.
import { openYtDlp, ytdlpInfo, ytdlpSearch } from "../ytdlp.js";

export default {
  id: "youtube",
  name: "YouTube",
  matchesHost: (host) => /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host),
  search: (query, limit) => ytdlpSearch("ytsearch", query, limit),
  fromUrl: (url) => ytdlpInfo(url),
  open: (track) => openYtDlp(track.url),
};
