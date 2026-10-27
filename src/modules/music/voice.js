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
