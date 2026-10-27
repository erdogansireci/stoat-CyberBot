// Bir sunucudaki ses bağlantısı, kuyruk ve çalma durumu.
import { MediaPlayer } from "./revoicePatch.js";
import { say, shortError, withTimeout } from "../../core/chat.js";
import { Attempts } from "./resolver.js";
import { cleanTitle } from "./match.js";

const START_TIMEOUT_MS = 30000;

// Başlık zaten "Sanatçı - Şarkı" ise yükleyen adını ekleme; "(Official Video)" gibi ekleri at.
function displayTitle(cand) {
  if (cand.isRadio) return cand.title;
  const title = cleanTitle(cand.title);
  if (!title) return null;
  if (!cand.artist || /\s[-–—]\s/.test(title) || title.toLowerCase().includes(cand.artist.toLowerCase())) {
    return title;
  }
  return `${cand.artist} - ${title}`;
}

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

  async join(channelId, channelName) {
    if (this.connected && this.channelId === channelId) return false;
    if (this.connected) await this.leave();

    // Eski, yarım kalmış bağlantı kaydı varsa revoice yeni katılımı reddeder.
    this.revoice.connections.delete(channelId);

    const connection = await withTimeout(this.revoice.join(channelId), 15000, "join_call");
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
      console.error("[playNext]", e);
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
    player.once("startplay", () => clearTimeout(watchdog));

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
