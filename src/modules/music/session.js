// Bir sunucudaki ses bağlantısı, kuyruk ve çalma durumu.
import { MediaPlayer } from "./revoicePatch.js";
import { describeError, say, shortError, withTimeout } from "../../core/chat.js";
import { Attempts } from "./resolver.js";
import { displayTitle } from "./match.js";

const START_TIMEOUT_MS = 30000;
const STALL_MS = 30000;
const JOIN_RETRIES = 5;
const JOIN_RETRY_MS = 10000;

export class MusicSession {
  constructor(revoice) {
    this.revoice = revoice;
    this.channelId = null;
    this.channelName = null;
    this.connection = null;
    this.player = null;

    this.queue = [];
    this.current = null; // { item, title, sourceName, isRadio }
    this.state = "idle"; // idle | loading | playing
    this.gen = 0; // her skip/stop'ta artar; eski işlemler kendini iptal eder
    this.handle = null; // { stream, close }
    this.textChannel = null;
    this.volume = 100; // 1-100; şarkılar ve kanal değişiminde korunur
  }

  // Oynatıcı her şarkıda ses ayarını sıfırladığı için seviye burada tutulup tekrar uygulanır.
  // Logaritmik ölçek: 50 kulağa "yarısı" gibi gelir.
  #applyVolume() {
    this.player?.volumeTransformer?.setVolumeLogarithmic(this.volume / 100);
  }

  setVolume(value) {
    this.volume = Math.max(1, Math.min(100, Math.round(value)));
    this.#applyVolume();
    return this.volume;
  }

  get connected() {
    return !!(this.connection && this.player);
  }

  notify(text) {
    return say(this.textChannel, text);
  }

  // revoice.join() API hatasında asılı kalır; patchRevoice'un "joinError" olayı onu hemen bitirir.
  async #requestConnection(channelId) {
    // Eski, yarım kalmış bağlantı kaydı varsa revoice yeni katılımı reddeder.
    this.revoice.connections.delete(channelId);
    let onJoinError;
    const failed = new Promise((_, reject) => {
      onJoinError = reject;
      this.revoice.once?.("joinError", reject);
    });
    try {
      return await withTimeout(Promise.race([this.revoice.join(channelId), failed]), 15000, "join_call");
    } finally {
      this.revoice.off?.("joinError", onJoinError);
    }
  }

  /**
   * onWait: bot kapanırken kanaldan çıkamadıysa sunucu onu bir süre hâlâ içeride sanar
   * (AlreadyConnected). Botlar bunu zorla kapatamadığı için ses sunucusu eski bağlantıyı
   * düşürene kadar beklenip tekrar denenir; ilk beklemede onWait çağrılır.
   */
  async join(channelId, channelName, { onWait } = {}) {
    if (this.connected && this.channelId === channelId) return false;
    if (this.connected) await this.leave();

    let connection;
    for (let attempt = 1; ; attempt++) {
      try {
        connection = await this.#requestConnection(channelId);
        break;
      } catch (e) {
        if (e?.code !== "AlreadyConnected" || attempt >= JOIN_RETRIES) throw e;
        if (attempt === 1) await onWait?.();
        console.warn(`[join] AlreadyConnected, ${JOIN_RETRY_MS / 1000} sn sonra tekrar (${attempt}/${JOIN_RETRIES})`);
        await new Promise((r) => setTimeout(r, JOIN_RETRY_MS));
      }
    }

    await withTimeout(
      new Promise((resolve) => connection.once("join", resolve)),
      15000,
      "ses bağlantısı"
    );

    const player = new MediaPlayer();
    connection.play(player);

    this.connection = connection;
    this.player = player;
    this.channelId = channelId;
    this.channelName = channelName ?? channelId;
    return true;
  }

  async leave() {
    this.stop();
    const conn = this.connection;
    const id = this.channelId;
    this.connection = null;
    this.player = null;
    this.channelId = null;
    this.channelName = null;
    if (conn) {
      try {
        await withTimeout(conn.leave(), 10000, "leave");
      } catch (e) {
        console.warn("[leave]", shortError(e));
      }
    }
    if (id) this.revoice.connections.delete(id);
  }

  // Çalan sesi ve indirmeyi keser; bekleyen arama sonuçlarını geçersiz kılar.
  #halt() {
    this.gen++;
    try { this.handle?.close(); } catch {}
    this.handle = null;
    try { this.player?.stop(); } catch (e) { console.warn("[player.stop]", shortError(e)); }
    this.state = "idle";
  }

  enqueue(item) {
    this.queue.push(item);
    if (this.state === "idle") this.playNext();
    return this.queue.length;
  }

  // Öğeyi sıranın başına koyup hemen çalar (radyo için).
  playNow(item) {
    this.queue.unshift(item);
    this.#halt();
    this.playNext();
  }

  skip() {
    if (this.state === "idle") return false;
    this.#halt();
    this.playNext();
    return true;
  }

  stop() {
    this.queue.length = 0;
    this.#halt();
    this.current = null;
  }

  clear() {
    const n = this.queue.length;
    this.queue.length = 0;
    return n;
  }

  async playNext() {
    const gen = ++this.gen;
    const item = this.queue.shift();
    if (!item) {
      this.current = null;
      this.state = "idle";
      return;
    }

    this.state = "loading";
    this.current = { item, title: item.title ?? item.input, isRadio: !!item.isRadio };
    const attempts = new Attempts();

    try {
      for await (const cand of item.candidates(attempts)) {
        if (gen !== this.gen) return;

        let handle;
        try {
          handle = await cand.open();
        } catch (e) {
          attempts.fail(cand.attemptName ?? cand.sourceName, "akış açılamadı", e);
          continue;
        }
        if (gen !== this.gen) {
          handle.close();
          return;
        }

        this.#start(gen, item, cand, handle);
        return;
      }
    } catch (e) {
      console.error("[playNext]", describeError(e));
      attempts.fail("bot", "beklenmeyen hata", e);
    }

    if (gen !== this.gen) return;
    const reasons = attempts.summary();
    await this.notify(
      `⚠️ Çalınamadı: ${item.title ?? item.input}${reasons ? `\n(${reasons})` : ""}`
    );
    this.state = "idle";
    this.playNext();
  }

  // Çalarken bağlantı takılırsa (indirme durur ama kapanmaz) bot sonsuza dek sessiz kalıyordu.
  // STALL_MS boyunca hiç ses çalınmazsa sıradakine geçilir.
  #watchStall(gen, player, title) {
    let last = player.playedOutSamples;
    let lastChange = Date.now();
    const timer = setInterval(() => {
      if (gen !== this.gen) return clearInterval(timer);
      if (player.playedOutSamples !== last || player.paused) {
        last = player.playedOutSamples;
        lastChange = Date.now();
        return;
      }
      if (Date.now() - lastChange < STALL_MS) return;
      clearInterval(timer);
      console.warn(`[müzik] ${STALL_MS / 1000} sn ses gelmedi, geçiliyor: ${title}`);
      this.notify(`⚠️ ${title} takıldı, sıradakine geçiyorum.`);
      this.#halt();
      this.playNext();
    }, 5000);
  }

  #start(gen, item, cand, handle) {
    const player = this.player;
    const title = displayTitle(cand) || item.input;

    this.handle = handle;
    this.state = "playing";
    this.current = { item, title, sourceName: cand.sourceName, isRadio: !!cand.isRadio };
    handle.stream.on("error", (e) => console.warn("[stream]", shortError(e)));

    // Şarkı kendiliğinden bitince sıradakine geç. skip/stop gen'i artırdığı için tetiklemez.
    player.once("finish", () => {
      if (gen !== this.gen) return;
      try { this.handle?.close(); } catch {}
      this.handle = null;
      this.playNext();
    });

    // Ses hiç başlamazsa (bozuk dosya vb.) takılı kalma.
    const watchdog = setTimeout(() => {
      if (gen !== this.gen || player.playing) return;
      console.warn(`[müzik] ses başlamadı, geçiliyor: ${title}`);
      this.notify(`⚠️ ${title} başlamadı, sıradakine geçiyorum.`);
      this.#halt();
      this.playNext();
    }, START_TIMEOUT_MS);
    player.once("startplay", () => {
      clearTimeout(watchdog);
      this.#watchStall(gen, player, title);
    });

    this.#applyVolume();
    player.playStream(handle.stream);

    if (cand.isRadio) {
      this.notify(`📻 Çalıyor: ${title}`);
    } else {
      const note = cand.weak ? " – tam eşleşme bulunamadı, en yakını" : "";
      this.notify(`🎤 Çalıyor: ${title} (${cand.sourceName}${note})`);
    }
  }
}
