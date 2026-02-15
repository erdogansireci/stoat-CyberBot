import "dotenv/config";

import WebSocket from "ws";
globalThis.WebSocket = WebSocket;

import { Client } from "stoat.js";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Revoice, MediaPlayer } = require("revoice.js");

import { spawn } from "node:child_process";
import { Readable } from "node:stream";

// Workaround for a known race in revoice.js MediaPlayer.stop():
// when ffmpeg is already finished and internal process reference is null,
// stop() may throw while trying to call kill() on null.
const rawMediaPlayerStop = MediaPlayer.prototype.stop;
MediaPlayer.prototype.stop = function patchedStop(init = true) {
  try {
    if (this?.ffmpegFinished && !this?.fProc) {
      this.ffmpegFinished = false;
    }
    return rawMediaPlayerStop.call(this, init);
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (msg.includes("Cannot read properties of null (reading 'kill')")) {
      try {
        if (init && typeof this?.initValues === "function") this.initValues();
        this?.emit?.("finish");
      } catch {}
      return;
    }
    throw err;
  }
};

const TOKEN = process.env.STOAT_BOT_TOKEN;
const PREFIX = process.env.PREFIX ?? "!";

if (!TOKEN) {
  console.error("STOAT_BOT_TOKEN yok (.env)!");
  process.exit(1);
}

const client = new Client();
const revoice = new Revoice(TOKEN);

// State
let voiceChannelId = null;
let connection = null;
let player = null;

const queue = [];
let nowPlaying = null;
let isPlaying = false;

function isProbablyUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function firstHttpLine(output) {
  return output
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x.startsWith("http"));
}

async function resolvePlayInput(input) {
  const raw = input.trim();
  if (!raw) throw new Error("Boş play argümanı.");

  if (isProbablyUrl(raw)) {
    return { url: raw, resolvedFromSearch: false, title: null };
  }

  const query = `ytsearch1:${raw}`;
  const resolvedUrlOut = await runYtDlp(
    [query, "--print", "%(webpage_url)s", "--skip-download", "-q"],
    { timeoutMs: 15000 }
  );
  const resolvedUrl = firstHttpLine(resolvedUrlOut);
  if (!resolvedUrl) throw new Error("Arama sonucu bulunamadı.");

  const resolvedTitle = await runYtDlp(
    [query, "--print", "%(title)s", "--skip-download", "-q"],
    { timeoutMs: 12000 }
  ).catch(() => null);

  return { url: resolvedUrl, resolvedFromSearch: true, title: resolvedTitle };
}

async function ensureJoined(vcId) {
  voiceChannelId = vcId;
  connection = await revoice.join(vcId);
  player = new MediaPlayer();

  return new Promise((resolve) => {
    connection.on("join", () => {
      connection.play(player);
      resolve();
    });
  });
}

function runYtDlp(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";

    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`yt-dlp timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    p.stdout.on("data", (d) => (out += d.toString("utf8")));
    p.stderr.on("data", (d) => (err += d.toString("utf8")));

    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out.trim());
      reject(new Error(`yt-dlp failed (code=${code}): ${err.trim()}`));
    });
  });
}

async function fetchWebStream(url, referer) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Origin": "https://www.youtube.com",
    "Referer": referer || "https://www.youtube.com/",
  };

  const res = await fetch(url, { redirect: "follow", headers });
  if (!res.ok || !res.body) throw new Error(`Audio fetch failed: ${res.status}`);
  return Readable.fromWeb(res.body);
}

async function fetchYouTubeAudioStream(input) {
  const videoUrl = input.trim();

  // Title (fail olursa "YouTube" kalsın)
  const title = await runYtDlp(["--print", "%(title)s", "-q", videoUrl], { timeoutMs: 12000 })
    .catch(() => "YouTube");

  // Direct media URL (audio)
  const audioUrls = await runYtDlp(
    ["-f", "bestaudio/best", "-g", "-q", videoUrl],
    { timeoutMs: 15000 }
  );

  const firstUrl = firstHttpLine(audioUrls);

  if (!firstUrl) throw new Error("yt-dlp audio URL boş döndü.");

  const stream = await fetchWebStream(firstUrl, videoUrl);
  return { stream, title };
}

async function playNext(textChannel) {
  if (isPlaying) return;

  const next = queue.shift();
  if (!next) {
    nowPlaying = null;
    return;
  }

  isPlaying = true;
  nowPlaying = next;

  try {
    const { stream, title } = await fetchYouTubeAudioStream(next.url);

    const onDone = async () => {
      if (!isPlaying) return;
      isPlaying = false;
      await playNext(textChannel);
    };

    stream.once("error", async (err) => {
      isPlaying = false;
      await textChannel.sendMessage(`⚠️ Stream hatası: ${String(err?.message ?? err)} (sıradaki)`);
      await playNext(textChannel);
    });

    stream.once("end", onDone);
    stream.once("close", onDone);

    player.playStream(stream);
    await textChannel.sendMessage(`🎤 Çalıyor: ${title}`);
  } catch (e) {
    isPlaying = false;
    await textChannel.sendMessage(`⚠️ Çalamadım: ${String(e?.message ?? e)}`);
    console.error(e);
    await playNext(textChannel);
  }
}

client.on("ready", async () => {
  console.log(`Bot online: ${client.user?.username} (${client.user?._id})`);
});

client.on("messageCreate", async (message) => {
  console.log("[messageCreate]", { content: message?.content });

  if (!message?.content) return;
  if (message.author === client.user?._id) return;
  if (!message.content.startsWith(PREFIX)) return;

  const textCh = message.channel;
  if (!textCh) return;

  const [cmd, ...rest] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const arg = rest.join(" ").trim();

  if (cmd === "ping") return textCh.sendMessage("pong ✅");

  if (cmd === "join") {
    if (!arg) return textCh.sendMessage("Kullanım: !join <voiceChannelId>");
    await ensureJoined(arg);
    return textCh.sendMessage("✅ Voice'a bağlandım.");
  }

  if (cmd === "play") {
    if (!voiceChannelId || !connection || !player) {
      return textCh.sendMessage("Önce voice'a bağlan: !join <voiceChannelId>");
    }
    if (!arg) return textCh.sendMessage("Kullanım: !play <youtube_link veya arama>");

    let item;
    try {
      item = await resolvePlayInput(arg);
    } catch (e) {
      return textCh.sendMessage(`⚠️ Arama/link çözülemedi: ${String(e?.message ?? e)}`);
    }

    queue.push({ url: item.url, requestedBy: message.author });
    if (item.resolvedFromSearch) {
      const foundTitle = item.title ? ` ${item.title}` : "";
      await textCh.sendMessage(`🔎 İlk sonuç bulundu:${foundTitle}\n${item.url}`);
    }
    await textCh.sendMessage(`➕ Kuyruğa eklendi. (Toplam: ${queue.length})`);
    await playNext(textCh);
    return;
  }

  if (cmd === "skip") {
    if (!player) return textCh.sendMessage("Şu an çalan bir şey yok.");
    try { player.stop?.(); } catch {}
    isPlaying = false;
    await textCh.sendMessage("🎤 Atlandı (sıradakine geçiyorum).");
    await playNext(textCh);
    return;
  }

  if (cmd === "stop") {
    queue.length = 0;
    isPlaying = false;
    nowPlaying = null;
    try { player.stop?.(); } catch {}
    return textCh.sendMessage("🎤 Durdurdum, kuyruk temizlendi.");
  }

  if (cmd === "queue") {
    if (!queue.length) return textCh.sendMessage("Kuyruk boş.");
    const lines = queue.slice(0, 10).map((x, i) => `${i + 1}) ${x.url}`).join("\n");
    return textCh.sendMessage("🎤 Kuyruk:\n" + lines);
  }
});

console.log("Bot başlatılıyor...");
client.loginBot(TOKEN);
