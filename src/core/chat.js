// Kanala mesaj gönderir; gönderilemezse sadece loglar.
export async function say(channel, text) {
  if (!channel || !text) return;
  try {
    await channel.sendMessage(noLinks(text));
  } catch (e) {
    console.error("[say]", e?.message ?? e);
  }
}

// Linkleri yazıya çevirir ki kanalda önizleme kutuları oluşmasın.
export function noLinks(text) {
  return String(text).replace(/https?:\/\/(\S+)/g, "$1");
}

// Uzun hata çıktısından log için tek satırlık özet çıkarır.
export function shortError(e) {
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
