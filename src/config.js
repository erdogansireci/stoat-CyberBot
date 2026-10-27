import "dotenv/config";
import { createRequire } from "module";

// Sürüm tek yerden, package.json'dan okunur.
const { version } = createRequire(import.meta.url)("../package.json");

function list(value) {
  return String(value ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  version,
  token: process.env.STOAT_BOT_TOKEN,
  prefix: process.env.PREFIX ?? "!",
  apiUrl: process.env.STOAT_API_URL ?? "https://stoat.chat/api",

  // Kelime aramasında aynı anda aranan kaynaklar; puan eşitse listede önce olan kazanır.
  // Kullanılabilir: soundcloud, audius, bandcamp, archive, youtube
  musicSources: list(process.env.MUSIC_SOURCES ?? "soundcloud,audius,bandcamp,archive"),

  // YouTube için isteğe bağlı cookie dosyası (Netscape formatı). Boşsa cookie kullanılmaz.
  ytdlpCookies: process.env.YTDLP_COOKIES || null,

  // Dış servislere kendimizi tanıtırken kullanılan ad (Audius, Radio-Browser).
  appName: "CyberBot",
};
