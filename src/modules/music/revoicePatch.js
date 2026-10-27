// revoice.js MediaPlayer için iki düzeltme:
// 1) stop(): ffmpeg bitmiş ve süreç referansı null ise kill() çağrısı çöküyordu.
// 2) playStream(): durdurulan eski ffmpeg'in geç gelen verisi/olayları yeni şarkıya
//    karışıp onu erken bitirebiliyordu. Her çalmaya bir nesil numarası verip eskileri yok sayıyoruz.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { MediaPlayer } = require("revoice.js");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

const rawStop = MediaPlayer.prototype.stop;

MediaPlayer.prototype.stop = function patchedStop(init = true) {
  this._gen = (this._gen ?? 0) + 1;
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
  proc.pipe().on("data", (chunk) => {
    if (!current()) return;
    this.chunks.push(chunk);
    if (this.readyPlayPacket && !this.paused) return this.playOutPacket();
  });
};

export { MediaPlayer };
