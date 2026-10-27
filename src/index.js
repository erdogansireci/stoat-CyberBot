import WebSocket from "ws";
globalThis.WebSocket = WebSocket;

import { Client } from "stoat.js";
import { createRequire } from "module";

import { config } from "./config.js";
import { CommandRouter } from "./core/commands.js";
import { describeError } from "./core/chat.js";
import { patchRevoice } from "./modules/music/revoicePatch.js";
import musicModule from "./modules/music/index.js";

const require = createRequire(import.meta.url);
const { Revoice } = require("revoice.js");

if (!config.token) {
  console.error("STOAT_BOT_TOKEN yok (.env)!");
  process.exit(1);
}

// Beklenmeyen hatalar sadece loga yazılsın, bot çökmesin. Ham nesne basılmaz (token sızmasın).
process.on("unhandledRejection", (err) => {
  if (err?.handled) return;
  console.error("[unhandledRejection]", describeError(err));
});

const client = new Client({ baseURL: config.apiUrl });
const revoice = patchRevoice(new Revoice(config.token, undefined, { baseURL: config.apiUrl }));

// Modüllerin ortak kullandığı nesneler.
const bot = { client, revoice, config };

const router = new CommandRouter(bot);

router.use({
  name: "Genel",
  commands: [
    {
      name: "ping",
      description: "Botun açık olup olmadığını kontrol eder.",
      run: (ctx) => ctx.reply("pong ✅"),
    },
    {
      name: "version",
      aliases: ["versiyon", "v"],
      description: "Botun sürümünü gösterir.",
      run: (ctx) => ctx.reply(`🤖 CyberBot v${config.version}`),
    },
    {
      name: "help",
      aliases: ["yardim", "yardım"],
      description: "Komut listesini gösterir.",
      run: (ctx) => ctx.reply(router.helpText()),
    },
  ],
});
router.use(musicModule(bot));
// Yeni entegrasyonlar buraya: router.use(redditModule(bot));

client.on("ready", () => {
  console.log(`Bot online: ${client.user?.username} (${client.user?.id}) v${config.version} @ ${config.apiUrl}`);
});

client.on("messageCreate", (message) => router.handle(message));

// Docker durdururken (deploy, restart) SIGTERM gönderir. Modüller kendini temizlesin
// (örn. ses kanalından çıkış), en fazla 5 sn beklenir. Modül şekli: { shutdown?() }.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} alındı, kapanıyor...`);
  await Promise.race([
    Promise.allSettled(router.modules.map((m) => m.shutdown?.())),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  process.exit(0);
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

console.log("Bot başlatılıyor...");
client.loginBot(config.token);
