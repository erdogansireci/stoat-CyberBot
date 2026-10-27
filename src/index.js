import WebSocket from "ws";
globalThis.WebSocket = WebSocket;

import { Client } from "stoat.js";
import { createRequire } from "module";

import { config } from "./config.js";
import { CommandRouter } from "./core/commands.js";
import musicModule from "./modules/music/index.js";

const require = createRequire(import.meta.url);
const { Revoice } = require("revoice.js");

if (!config.token) {
  console.error("STOAT_BOT_TOKEN yok (.env)!");
  process.exit(1);
}

// Beklenmeyen hatalar sadece loga yazılsın, bot çökmesin.
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));

const client = new Client({ baseURL: config.apiUrl });
const revoice = new Revoice(config.token, undefined, { baseURL: config.apiUrl });

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

console.log("Bot başlatılıyor...");
client.loginBot(config.token);
