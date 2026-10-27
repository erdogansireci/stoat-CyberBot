// !join için ses kanalını bulma: kullanıcının bulunduğu kanal, #kanal etiketi, kanal adı ya da ID.
import { normalize } from "./match.js";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function isVoiceChannel(ch) {
  return !!ch && (ch.isVoice || ch.type === "VoiceChannel");
}

function voiceChannels(server) {
  return (server?.channels ?? []).filter(isVoiceChannel);
}

/** Kullanıcının şu an içinde bulunduğu ses kanalı (yoksa null). */
export function findUserVoiceChannel(server, userId) {
  return voiceChannels(server).find((ch) => ch.voiceParticipants?.has(userId)) ?? null;
}

/** Sunucudaki ses kanallarının adları (kullanıcıya öneri için). */
export function voiceChannelNames(server) {
  return voiceChannels(server).map((ch) => ch.name);
}

/** Sunucuda tek ses kanalı varsa onu döner. */
export function onlyVoiceChannel(server) {
  const list = voiceChannels(server);
  return list.length === 1 ? list[0] : null;
}

/** Tanı için: botun gördüğü ses kanalları ve içindeki kullanıcı ID'leri. */
export function describeVoiceState(server) {
  return voiceChannels(server)
    .map((ch) => `${ch.name}(${ch.id}): [${[...(ch.voiceParticipants?.keys() ?? [])].join(", ")}]`)
    .join(" | ") || "(ses kanalı yok)";
}

/**
 * Tanı logu: Stoat'ın bota gönderdiği ses durumu olaylarını kısa satırlarla yazar.
 * Kullanıcının kanalı bulunamıyorsa sunucunun bu bilgiyi gönderip göndermediği buradan görülür.
 */
export function logVoiceEvents(client) {
  client.events?.on("event", (event) => {
    switch (event?.type) {
      case "Ready": {
        const states = event.voice_states ?? [];
        const total = states.reduce((n, s) => n + (s.participants?.length ?? 0), 0);
        console.log(`[ses-durumu] Ready: ${event.voice_states ? `${states.length} kanal, ${total} kişi` : "voice_states YOK"}`);
        break;
      }
      case "VoiceChannelJoin":
        console.log(`[ses-durumu] katıldı: kullanıcı ${event.state?.id} -> kanal ${event.id}`);
        break;
      case "VoiceChannelLeave":
        console.log(`[ses-durumu] ayrıldı: kullanıcı ${event.user} <- kanal ${event.id}`);
        break;
      case "VoiceChannelMove":
      case "UserMoveVoiceChannel":
        console.log(`[ses-durumu] ${event.type}: ${JSON.stringify(event).slice(0, 200)}`);
        break;
    }
  });
}

/**
 * "!join" argümanını kanala çevirir: <#ID>, ID ya da kanal adı (tam ya da kısmi eşleşme).
 * Döner: { id, name } ya da null.
 */
export function resolveChannelArg(server, client, arg) {
  const text = arg.trim();
  const id = text.match(/^<#([0-9A-Z]{26})>$/i)?.[1] ?? (ULID.test(text) ? text : null);
  if (id) {
    const ch = client.channels.get(id);
    return { id, name: ch?.name ?? id };
  }

  const wanted = normalize(text.replace(/^#/, ""));
  const list = voiceChannels(server);
  const ch =
    list.find((c) => normalize(c.name) === wanted) ??
    list.find((c) => normalize(c.name).includes(wanted));
  return ch ? { id: ch.id, name: ch.name } : null;
}
