// Müzik modülü: ses kanalına katılma, arama/link ile çalma, kuyruk ve radyo komutları.
import { shortError } from "../../core/chat.js";
import { MusicSession } from "./session.js";
import { findPlayable } from "./resolver.js";
import { describeStation, radioItem, searchStations } from "./radio.js";
import { findUserVoiceChannel, resolveChannelArg } from "./voice.js";
import { SEARCH_SOURCES } from "./sources/index.js";

export default function musicModule(bot) {
  const sessions = new Map(); // sunucu ID -> MusicSession
  const lastStations = new Map(); // sunucu ID -> son !radio liste sonucu

  console.log(`[müzik] arama sırası: ${SEARCH_SOURCES.map((s) => s.name).join(" -> ")}`);

  const keyOf = (ctx) => ctx.server?.id ?? ctx.channel.id;

  function sessionOf(ctx) {
    const key = keyOf(ctx);
    if (!sessions.has(key)) sessions.set(key, new MusicSession(bot.revoice));
    const s = sessions.get(key);
    s.textChannel = ctx.channel;
    return s;
  }

  async function joinChannel(ctx, session, channel) {
    try {
      const joined = await session.join(channel.id, channel.name);
      return joined ? "joined" : "already";
    } catch (e) {
      console.error("[join]", e);
      await ctx.reply(`⚠️ ${channel.name} kanalına bağlanamadım (${shortError(e).slice(0, 80)}).`);
      return null;
    }
  }

  // Bot bağlı değilse komutu yazanın ses kanalına katılır.
  async function ensureVoice(ctx, session) {
    if (session.connected) return true;
    const channel = findUserVoiceChannel(ctx.server, ctx.authorId);
    if (!channel) {
      await ctx.reply(`Önce bir ses kanalına gir ya da ${ctx.prefix}join <kanal adı> yaz.`);
      return false;
    }
    const res = await joinChannel(ctx, session, channel);
    if (res === "joined") await ctx.reply(`✅ ${channel.name} kanalına geldim.`);
    return !!res;
  }

  function songItem(input) {
    return {
      input,
      title: null,
      candidates: (attempts) => findPlayable(input, attempts),
    };
  }

  function nowPlayingLine(session) {
    const c = session.current;
    if (!c) return null;
    if (session.state === "loading") return `🔎 Hazırlanıyor: ${c.title}`;
    if (c.isRadio) return `📻 Şimdi (radyo): ${c.title}`;
    return `▶️ Şimdi: ${c.title}${c.sourceName ? ` (${c.sourceName})` : ""}`;
  }

  async function startRadio(ctx, stations, index) {
    const session = sessionOf(ctx);
    if (!(await ensureVoice(ctx, session))) return;
    const hadQueue = session.queue.length;
    session.playNow(radioItem(stations, index));
    const note = hadQueue ? ` Kuyruktaki ${hadQueue} şarkı radyo kapanınca çalar.` : "";
    await ctx.reply(`📻 Radyo açılıyor: ${describeStation(stations[index])}.${note}`);
  }

  return {
    name: "Müzik",
    commands: [
      {
        name: "join",
        usage: "[kanal adı | #kanal | ID]",
        description: "Botu ses kanalına çağırır. Boş bırakılırsa bulunduğun kanala gelir.",
        async run(ctx) {
          const session = sessionOf(ctx);
          let channel;
          if (ctx.arg) {
            channel = resolveChannelArg(ctx.server, ctx.bot.client, ctx.arg);
            if (!channel) return ctx.reply(`"${ctx.arg}" adında bir ses kanalı bulamadım.`);
          } else {
            channel = findUserVoiceChannel(ctx.server, ctx.authorId);
            if (!channel) {
              return ctx.reply(`Bir ses kanalında değilsin. ${ctx.prefix}join <kanal adı> ile de çağırabilirsin.`);
            }
          }
          const res = await joinChannel(ctx, session, channel);
          if (res === "joined") return ctx.reply(`✅ ${channel.name} kanalına bağlandım.`);
          if (res === "already") return ctx.reply(`Zaten ${channel.name} kanalındayım.`);
        },
      },
      {
        name: "leave",
        aliases: ["disconnect"],
        description: "Botu ses kanalından çıkarır (kuyruk temizlenir).",
        async run(ctx) {
          const session = sessionOf(ctx);
          if (!session.connected) return ctx.reply("Zaten bir ses kanalında değilim.");
          const name = session.channelName;
          await session.leave();
          return ctx.reply(`👋 ${name} kanalından çıktım.`);
        },
      },
      {
        name: "play",
        aliases: ["p"],
        usage: "<link | şarkı adı>",
        description: "Şarkı çalar ya da kuyruğa ekler. Bot bağlı değilse kanalına gelir.",
        async run(ctx) {
          if (!ctx.arg) return ctx.reply(`Kullanım: ${ctx.prefix}play <link veya şarkı adı>`);
          const session = sessionOf(ctx);
          if (!(await ensureVoice(ctx, session))) return;

          const item = songItem(ctx.arg);
          if (session.current?.isRadio) {
            session.playNow(item);
            return ctx.reply(`📻 Radyo kapatıldı. 🔎 Aranıyor: ${ctx.arg}`);
          }
          const wasIdle = session.state === "idle";
          const pos = session.enqueue(item);
          if (wasIdle) return ctx.reply(`🔎 Aranıyor: ${ctx.arg}`);
          return ctx.reply(`➕ Kuyruğa eklendi: ${ctx.arg} (sırada ${pos}.)`);
        },
      },
      {
        name: "skip",
        aliases: ["s", "next"],
        description: "Çalan şarkıyı (ya da radyoyu) geçer.",
        async run(ctx) {
          const session = sessionOf(ctx);
          if (session.state === "idle") return ctx.reply("Şu an çalan bir şey yok.");
          const title = session.current?.title;
          await ctx.reply(`⏭️ Geçildi: ${title}${session.queue.length ? "" : " (kuyruk boş)"}`);
          session.skip();
        },
      },
      {
        name: "stop",
        description: "Çalmayı durdurur ve kuyruğu temizler. Bot kanalda kalır.",
        async run(ctx) {
          const session = sessionOf(ctx);
          if (session.state === "idle" && !session.queue.length) {
            return ctx.reply("Zaten çalan bir şey yok.");
          }
          session.stop();
          return ctx.reply("⏹️ Durdurdum, kuyruk temizlendi.");
        },
      },
      {
        name: "clear",
        description: "Kuyruktaki şarkıları siler, çalan şarkı devam eder.",
        async run(ctx) {
          const n = sessionOf(ctx).clear();
          return ctx.reply(n ? `🧹 Kuyruktan ${n} şarkı silindi.` : "Kuyruk zaten boş.");
        },
      },
      {
        name: "queue",
        aliases: ["q"],
        description: "Çalan şarkıyı ve sıradakileri gösterir.",
        async run(ctx) {
          const session = sessionOf(ctx);
          const now = nowPlayingLine(session);
          if (!now && !session.queue.length) return ctx.reply("Çalan bir şey yok, kuyruk boş.");

          const lines = [now ?? "Şu an çalan bir şey yok."];
          if (session.queue.length) {
            lines.push("", "Sırada:");
            session.queue.slice(0, 10).forEach((x, i) => lines.push(`${i + 1}) ${x.title ?? x.input}`));
            if (session.queue.length > 10) lines.push(`… ve ${session.queue.length - 10} tane daha`);
          } else {
            lines.push("Kuyruk boş.");
          }
          return ctx.reply(lines.join("\n"));
        },
      },
      {
        name: "radio",
        aliases: ["radyo"],
        usage: "<tür | istasyon> | liste <tür> | <numara>",
        description: "İnternet radyosu çalar. Örn: !radio lofi, !radio liste jazz, !radio 2",
        async run(ctx) {
          const key = keyOf(ctx);
          const [first, ...rest] = ctx.args;
          if (!first) {
            return ctx.reply(
              `Kullanım: ${ctx.prefix}radio lofi | ${ctx.prefix}radio liste jazz | ${ctx.prefix}radio 2`
            );
          }

          if (/^\d+$/.test(first) && !rest.length) {
            const stations = lastStations.get(key);
            const index = Number(first) - 1;
            if (!stations?.length) return ctx.reply(`Önce ${ctx.prefix}radio liste <tür> ile arama yap.`);
            if (!stations[index]) return ctx.reply(`1 ile ${stations.length} arasında bir numara yaz.`);
            return startRadio(ctx, stations, index);
          }

          const listOnly = ["liste", "list"].includes(first.toLowerCase());
          const term = (listOnly ? rest : ctx.args).join(" ").trim();
          if (!term) return ctx.reply(`Kullanım: ${ctx.prefix}radio liste <tür>`);

          let stations;
          try {
            stations = await searchStations(term, 5);
          } catch (e) {
            console.error("[radio]", e);
            return ctx.reply("⚠️ Radyo rehberine şu an ulaşılamıyor, birazdan tekrar dene.");
          }
          if (!stations.length) return ctx.reply(`📻 "${term}" için istasyon bulunamadı.`);
          lastStations.set(key, stations);

          if (listOnly) {
            const lines = stations.map((s, i) => `${i + 1}) ${describeStation(s)}`);
            return ctx.reply(`📻 "${term}" istasyonları:\n${lines.join("\n")}\nÇalmak için: ${ctx.prefix}radio <numara>`);
          }
          return startRadio(ctx, stations, 0);
        },
      },
    ],
  };
}
