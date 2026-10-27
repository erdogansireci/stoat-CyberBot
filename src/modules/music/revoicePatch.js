// revoice.js MediaPlayer için düzeltmeler:
// 1) stop(): ffmpeg bitmiş ve süreç referansı null ise kill() çağrısı çöküyordu.
// 2) playStream(): durdurulan eski ffmpeg'in geç gelen verisi/olayları yeni şarkıya
//    karışıp onu erken bitirebiliyordu. Her çalmaya bir nesil numarası verip eskileri yok sayıyoruz.
// 3) Tampon sınırı: çözülen ses sınırsızca belleğe doluyordu (aşağıda BUFFER_HIGH_SEC).
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { MediaPlayer } = require("revoice.js");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
import { shortError } from "../../core/chat.js";

const rawStop = MediaPlayer.prototype.stop;

MediaPlayer.prototype.stop = function patchedStop(init = true) {
  this._gen = (this._gen ?? 0) + 1;
  this._out = null;
  const proc = this.fProc;
  this.fProc = null;
  this.ffmpegFinished = false;
  if (proc) {
    try { proc.kill("SIGKILL"); } catch {}
  }
  return rawStop.call(this, init);
};

MediaPlayer.prototype.playStream = function patchedPlayStream(stream) {
  const gen = (this._gen = (this._gen ?? 0) + 1);
  const current = () => this._gen === gen;
  // ffmpeg bittiğinde çalınacak veri kalmadıysa şarkıyı bitir (aksi halde sonsuza dek bekliyordu).
  const finishIfDrained = () =>
    setTimeout(() => {
      if (current() && this.chunks.length === 0 && this.readyPlayPacket) this.stop();
    }, 500);

  this.emit("buffer");
  this.originStream = stream;
  this.started = false;
  this.ffmpegFinished = false;
  this.playedOutSamples = 0;

  const proc = ffmpeg(stream)
    .noVideo()
    .setFfmpegPath(ffmpegPath)
    .outputOptions([`-f s16le`, `-ar ${this.SAMPLE_RATE}`, `-ac ${this.CHANNELS}`])
    .on("error", (err) => {
      if (!current()) return;
      if (!String(err?.message).includes("SIGKILL")) console.warn("[ffmpeg]", err?.message);
      this.ffmpegFinished = true;
      finishIfDrained();
    })
    .on("codecData", (d) => {
      if (current()) this.codecData = d;
    })
    .on("end", () => {
      if (!current()) return;
      this.ffmpegFinished = true;
      finishIfDrained();
    });

  this.fProc = proc;
  const out = proc.pipe();
  this._out = out;
  out.on("data", (chunk) => {
    if (!current()) return;
    this.chunks.push(chunk);
    // Tampon dolduysa ffmpeg'i (ve dolayısıyla indirmeyi) bekletiyoruz; playOutPacket açar.
    if (bufferedSeconds(this) >= BUFFER_HIGH_SEC) out.pause();
    if (this.readyPlayPacket && !this.paused) return this.playOutPacket();
  });
};

// ffmpeg sesi gerçek zamandan çok hızlı çözüyor; sınır olmasa 4 dk'lık şarkı ~45 MB,
// 3 saatlik mix ~2 GB olarak belleğe dolar. En fazla BUFFER_HIGH_SEC kadar ses biriktirilir.
const BUFFER_HIGH_SEC = 15;
const BUFFER_LOW_SEC = 5;

function bufferedSeconds(player) {
  let bytes = 0;
  for (const c of player.chunks) bytes += c.length;
  return bytes / (player.SAMPLE_RATE * player.CHANNELS * 2);
}

const rawPlayOutPacket = MediaPlayer.prototype.playOutPacket;
MediaPlayer.prototype.playOutPacket = function patchedPlayOutPacket() {
  if (this._out?.isPaused() && bufferedSeconds(this) <= BUFFER_LOW_SEC) this._out.resume();
  return rawPlayOutPacket.call(this);
};

/**
 * revoice.join() API hatasını yutup asılı kalıyordu; hata "joinError" olayıyla iletilir ve
 * token içeren ham axios hatası yerine kısa bir hata fırlatılır (err.code = API hata türü).
 * Not: botlar join_call'da force_disconnect kullanamaz (sunucu "IsBot" ile reddeder).
 */
export function patchRevoice(revoice) {
  const api = revoice.api;
  const post = api.post.bind(api);
  api.post = async (path, body, ...rest) => {
    if (typeof path !== "string" || !path.endsWith("/join_call")) return post(path, body, ...rest);
    try {
      return await post(path, body, ...rest);
    } catch (e) {
      const err = new Error(`join_call başarısız: ${shortError(e)}`);
      err.code = e?.response?.data?.type ?? null;
      err.handled = true; // session.join zaten raporluyor; unhandledRejection tekrar loglamasın
      revoice.emit("joinError", err);
      throw err;
    }
  };
  return revoice;
}

export { MediaPlayer };
