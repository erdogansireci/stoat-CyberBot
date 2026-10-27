// Kanala mesaj gönderir; gönderilemezse sadece loglar.
export async function say(channel, text) {
  if (!channel || !text) return;
  try {
    await channel.sendMessage(noLinks(text));
  } catch (e) {
    console.error("[say]", shortError(e));
  }
}

// Linkleri yazıya çevirir ki kanalda önizleme kutuları oluşmasın.
export function noLinks(text) {
  return String(text).replace(/https?:\/\/(\S+)/g, "$1");
}

// API (axios) hataları istek başlıklarını, yani bot token'ını da içerir; sadece güvenli özeti al.
function apiErrorSummary(e) {
  if (!e?.isAxiosError && !e?.response?.status) return null;
  const { method, url } = e.config ?? {};
  const type = e.response?.data?.type;
  return `API ${e.response?.status ?? "?"}${type ? ` ${type}` : ""} (${String(method ?? "").toUpperCase()} ${url ?? "?"})`;
}

// Log için güvenli hata metni: API hatalarında özet, diğerlerinde stack.
export function describeError(e) {
  return apiErrorSummary(e) ?? (e?.stack || String(e));
}

// Uzun hata çıktısından log için tek satırlık özet çıkarır.
export function shortError(e) {
  const api = apiErrorSummary(e);
  if (api) return api;
  const msg = String(e?.message ?? e ?? "");
  const lines = msg.split("\n").map((x) => x.trim()).filter(Boolean);
  const line = lines.find((x) => x.includes("ERROR:")) ?? lines[0] ?? "bilinmeyen hata";
  return line.slice(0, 300);
}

export function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} zaman aşımı (${ms}ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
