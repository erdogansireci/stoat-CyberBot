// Müzik modülü: ses kanalına katılma, arama/link ile çalma, kuyruk ve radyo komutları.
import { describeError, shortError } from "../../core/chat.js";
import { MusicSession } from "./session.js";
import { Attempts, findPlayable, isUrl, searchList } from "./resolver.js";
import { displayTitle, formatDuration } from "./match.js";
import { describeStation, radioItem, searchStations } from "./radio.js";
import {
  describeVoiceState,
  findUserVoiceChannel,
  logVoiceEvents,
  onlyVoiceChannel,
  resolveChannelArg,
  voiceChannelNames,
} from "./voice.js";
import { SEARCH_SOURCES } from "./sources/index.js";

// Stoat join_call hata türlerinin kullanıcıya gösterilecek karşılıkları.
const JOIN_ERRORS = {
  AlreadyConnected: "önceki bağlantı hâlâ açık görünüyor, biraz sonra tekrar dene.",
  NotAVoiceChannel: "bu bir ses kanalı değil.",
  CannotJoinCall: "kanal dolu.",
  MissingPermission: "bu kanala bağlanma yetkim yok.",
  LiveKitUnavailable: "sunucuda ses servisi çalışmıyor.",
  UnknownNode: "sunucunun ses ayarı (node) bulunamadı.",
};

export default function musicModule(bot) {
  const sessions = new Map(); // sunucu ID -> MusicSession
  const lastStations = new Map(); // sunucu ID -> son !radio list sonucu
  const songLists = new Map(); // metin kanalı ID -> son !play list sonucu

  console.log(`[müzik] arama sırası: ${SEARCH_SOURCES.map((s) => s.name).join(" -> ")}`);
  logVoiceEvents(bot.client);

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
      const joined = await session.join(channel.id, channel.name, {
        onWait: () => ctx.reply("⏳ Önceki ses bağlantım hâlâ açık görünüyor, kapanınca giriyorum (en fazla ~40 sn)."),
      });
      return joined ? "joined" : "already";
    } catch (e) {
      console.error("[join]", describeError(e));
      const reason = JOIN_ERRORS[e?.code] ?? shortError(e).slice(0, 80);
      await ctx.reply(`⚠️ ${channel.name} kanalına bağlanamadım: ${reason}`);
      return null;
    }
  }

  // Komutu yazanın ses kanalı; bulunamazsa sunucudaki tek ses kanalı. Hiçbiri yoksa
  // kanal adlarını önerir ve tanı için botun gördüğü ses durumunu loglar.
  async function channelForAuthor(ctx) {
    const channel = findUserVoiceChannel(ctx.server, ctx.authorId) ?? onlyVoiceChannel(ctx.server);
    if (channel) return channel;

    console.warn(`[ses-durumu] ${ctx.authorId} bulunamadı. Görülen: ${describeVoiceState(ctx.server)}`);
    const names = voiceChannelNames(ctx.server);
    const hint = names.length ? `\nKanallar: ${names.join(", ")} → örn. ${ctx.prefix}join ${names[0]}` : "";
    await ctx.reply(`Bulunduğun ses kanalını göremedim, kanal adıyla çağır.${hint}`);
    return null;
  }

  // Bot bağlı değilse komutu yazanın ses kanalına katılır.
  async function ensureVoice(ctx, session) {
    if (session.connected) return true;
    const channel = await channelForAuthor(ctx);
    if (!channel) return false;
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

  // Listeden seçilen kayıt önce çalınır; açılmazsa aynı arama normal yoldan yapılır.
  function pickedItem(picked, query) {
    return {
      input: query,
      title: displayTitle(picked),
      async *candidates(attempts) {
        yield picked;
        for await (const c of findPlayable(query, attempts)) {
          if (c.url !== picked.url) yield c;
        }
      },
    };
  }

  async function showList(ctx, query) {
    const attempts = new Attempts();
    const items = await searchList(query, attempts);
    if (!items.length) {
      const reasons = attempts.summary();
      return ctx.reply(`🔎 "${query}" için sonuç bulunamadı.${reasons ? `\n(${reasons})` : ""}`);
    }
    songLists.set(ctx.channel.id, { query, items });

    const lines = items.map((t, i) => {
      const title = displayTitle(t);
      const short = title.length > 60 ? title.slice(0, 57) + "…" : title;
      const meta = [formatDuration(t.duration), t.sourceName].filter(Boolean).join(" · ");
      return `**${i + 1}.** ${short}  \`${meta}\``;
    });
    return ctx.reply(`🔎 **${query}**\n${lines.join("\n")}\n▶️ Seçmek için: ${ctx.prefix}play 1-${items.length}`);
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
    // Bot kapanırken ses kanallarından çık; yoksa sunucu botu bir süre hâlâ bağlı sanır.
    async shutdown() {
      await Promise.allSettled([...sessions.values()].filter((s) => s.connected).map((s) => s.leave()));
    },
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
            channel = await channelForAuthor(ctx);
            if (!channel) return;
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
        usage: "<link | şarkı adı> | list <şarkı adı> | <numara>",
        description: "Şarkı çalar ya da kuyruğa ekler. list ile 6 sonuç listeler, numarayla seçilir.",
        async run(ctx) {
          if (!ctx.arg) {
            return ctx.reply(
              `Kullanım: ${ctx.prefix}play <şarkı> | ${ctx.prefix}play list <şarkı> | ${ctx.prefix}play 2`
            );
          }
          const [first, ...rest] = ctx.args;

          // !play list <şarkı>: sonuçları listele, çalma.
          if (["list", "liste"].includes(first.toLowerCase())) {
            const query = rest.join(" ").trim();
            if (!query) return ctx.reply(`Kullanım: ${ctx.prefix}play list <şarkı adı>`);
            if (isUrl(query)) return ctx.reply("Liste için şarkı adı yaz, link doğrudan çalınabilir.");
            return showList(ctx, query);
          }

          // !play 2: kanalda açık liste varsa ondan seç; yoksa normal arama.
          const list = songLists.get(ctx.channel.id);
          const pickIndex = /^\d+$/.test(ctx.arg) ? Number(ctx.arg) - 1 : -1;
          const picked = list?.items[pickIndex];

          const session = sessionOf(ctx);
          if (!(await ensureVoice(ctx, session))) return;

          const item = picked ? pickedItem(picked, list.query) : songItem(ctx.arg);
          const label = picked ? displayTitle(picked) : ctx.arg;
          if (session.current?.isRadio) {
            session.playNow(item);
            return ctx.reply(`📻 Radyo kapatıldı. ${picked ? "▶️" : "🔎 Aranıyor:"} ${label}`);
          }
          const wasIdle = session.state === "idle";
          const pos = session.enqueue(item);
          if (wasIdle) return picked ? null : ctx.reply(`🔎 Aranıyor: ${label}`);
          return ctx.reply(`➕ Kuyruğa eklendi: ${label} (sırada ${pos}.)`);
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
        name: "volume",
        aliases: ["vol", "ses"],
        usage: "[1-100 | +10 | -10]",
        description: "Ses seviyesini gösterir ya da ayarlar.",
        async run(ctx) {
          const session = sessionOf(ctx);
          if (!ctx.arg) return ctx.reply(`🔊 Ses: ${session.volume}`);

          const m = ctx.arg.replace("%", "").match(/^([+-])?\s*(\d+)$/);
          if (!m) return ctx.reply(`Kullanım: ${ctx.prefix}volume 50 | ${ctx.prefix}volume +10 | ${ctx.prefix}volume -10`);
          const n = Number(m[2]);
          const target = m[1] === "+" ? session.volume + n : m[1] === "-" ? session.volume - n : n;
          if (!m[1] && (n < 1 || n > 100)) return ctx.reply("Ses 1 ile 100 arasında olmalı.");

          const v = session.setVolume(target);
          return ctx.reply(`${v <= 30 ? "🔈" : v <= 70 ? "🔉" : "🔊"} Ses: ${v}`);
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
        usage: "<tür | istasyon> | list <tür> | <numara>",
        description: "İnternet radyosu çalar. Örn: !radio lofi, !radio list jazz, !radio 2",
        async run(ctx) {
          const key = keyOf(ctx);
          const [first, ...rest] = ctx.args;
          if (!first) {
            return ctx.reply(
              `Kullanım: ${ctx.prefix}radio lofi | ${ctx.prefix}radio list jazz | ${ctx.prefix}radio 2`
            );
          }

          if (/^\d+$/.test(first) && !rest.length) {
            const stations = lastStations.get(key);
            const index = Number(first) - 1;
            if (!stations?.length) return ctx.reply(`Önce ${ctx.prefix}radio list <tür> ile arama yap.`);
            if (!stations[index]) return ctx.reply(`1 ile ${stations.length} arasında bir numara yaz.`);
            return startRadio(ctx, stations, index);
          }

          const listOnly = ["list", "liste"].includes(first.toLowerCase());
          const term = (listOnly ? rest : ctx.args).join(" ").trim();
          if (!term) return ctx.reply(`Kullanım: ${ctx.prefix}radio list <tür>`);

          let stations;
          try {
            stations = await searchStations(term);
          } catch (e) {
            console.error("[radio]", describeError(e));
            return ctx.reply("⚠️ Radyo rehberine şu an ulaşılamıyor, birazdan tekrar dene.");
          }
          if (!stations.length) return ctx.reply(`📻 "${term}" için istasyon bulunamadı.`);
          lastStations.set(key, stations);

          if (listOnly) {
            const lines = stations.map((s, i) => {
              const meta = [s.country, s.bitrate ? `${s.bitrate}kbps` : null].filter(Boolean).join(" · ");
              return `**${i + 1}.** ${s.name}${meta ? `  \`${meta}\`` : ""}`;
            });
            return ctx.reply(`📻 **${term}**\n${lines.join("\n")}\n▶️ Seçmek için: ${ctx.prefix}radio 1-${stations.length}`);
          }
          return startRadio(ctx, stations, 0);
        },
      },
    ],
  };
}
