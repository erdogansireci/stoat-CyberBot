import { spawn } from "node:child_process";
import { createRequire } from "module";
import { config } from "../../config.js";
import { shortError } from "../../core/chat.js";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

const COMMON = ["-q", "--no-warnings", "--no-playlist", "--playlist-items", "1"];

function isYouTube(target) {
  return /youtube\.com|youtu\.be|^ytsearch/i.test(target);
}

function argsFor(target, extra) {
  const args = [target, ...COMMON, ...extra];
  if (config.ytdlpCookies && isYouTube(target)) args.push("--cookies", config.ytdlpCookies);
  return args;
}

export function runYtDlp(args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";

    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`yt-dlp zaman aşımı (${timeoutMs}ms)`));
    }, timeoutMs);

    p.stdout.on("data", (d) => (out += d.toString("utf8")));
    p.stderr.on("data", (d) => (err += d.toString("utf8")));

    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out.trim());
      reject(new Error(`yt-dlp failed (code=${code}): ${err.trim()}`));
    });
  });
}

function toTrack(e) {
  // Mixcloud gibi kaynaklarda "artist" alanı mixteki tüm sanatçıların listesi olabiliyor.
  const artist = e.artist && e.artist.length <= 40 ? e.artist : null;
  return {
    title: e.title ?? e.track ?? null,
    artist: artist ?? e.uploader ?? e.channel ?? null,
    duration: Number(e.duration) || null,
    url: e.webpage_url ?? e.url,
  };
}

// "scsearch5:..." gibi bir aramanın sonuçlarını indirmeden listeler.
export async function ytdlpSearch(prefix, query, limit = 5) {
  const target = `${prefix}${limit}:${query}`;
  const out = await runYtDlp(
    [target, "-q", "--no-warnings", "--flat-playlist", "-J",
      ...(config.ytdlpCookies && isYouTube(target) ? ["--cookies", config.ytdlpCookies] : [])],
    { timeoutMs: 20000 }
  );
  return (JSON.parse(out).entries ?? []).map(toTrack).filter((t) => t.url);
}

// Tek bir linkin başlık/sanatçı/süre bilgisini getirir.
export async function ytdlpInfo(url) {
  const out = await runYtDlp(
    argsFor(url, ["-O", "%(.{title,track,artist,uploader,channel,duration,webpage_url})j"]),
    { timeoutMs: 20000 }
  );
  const line = out.split("\n").find((x) => x.startsWith("{"));
  if (!line) throw new Error("yt-dlp bilgi döndürmedi");
  return toTrack(JSON.parse(line));
}

// Sesi stdout'a indirir; HLS gibi formatları da yt-dlp kendisi çözer.
// İlk veri gelene kadar bekler, gelmezse hata fırlatır.
export function openYtDlp(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "yt-dlp",
      argsFor(url, ["-f", "bestaudio/best", "--ffmpeg-location", ffmpegPath, "-o", "-"]),
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let err = "";
    let started = false;
    p.stderr.on("data", (d) => (err += d.toString("utf8")));
    p.stdout.on("error", () => {});

    const close = () => {
      try { p.kill("SIGKILL"); } catch {}
    };

    const timer = setTimeout(() => {
      close();
      reject(new Error("yt-dlp akış zaman aşımı"));
    }, timeoutMs);

    const onReadable = () => {
      if (p.stdout.readableLength === 0) return;
      p.stdout.off("readable", onReadable);
      clearTimeout(timer);
      started = true;
      resolve({ stream: p.stdout, close });
    };
    p.stdout.on("readable", onReadable);

    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (started && code !== 0 && code !== null) {
        console.warn(`[yt-dlp] akış yarıda kesildi (code=${code}): ${shortError(err)}`);
      }
      reject(new Error(`yt-dlp stream failed (code=${code}): ${err.trim()}`));
    });
  });
}
