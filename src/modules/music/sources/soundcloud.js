import { openYtDlp, ytdlpInfo, ytdlpSearch } from "../ytdlp.js";

export default {
  id: "soundcloud",
  name: "SoundCloud",
  matchesHost: (host) => /(^|\.)soundcloud\.com$|^on\.soundcloud\.com$/.test(host),
  search: (query, limit) => ytdlpSearch("scsearch", query, limit),
  fromUrl: (url) => ytdlpInfo(url),
  open: (track) => openYtDlp(track.url),
};
