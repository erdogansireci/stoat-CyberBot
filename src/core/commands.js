import { say, shortError } from "./chat.js";

/**
 * Komutları modüllerden toplayıp mesajlara dağıtır.
 *
 * Modül şekli:
 *   {
 *     name: "Müzik",
 *     commands: [
 *       { name: "play", aliases: ["p"], usage: "<link | arama>", description: "...", run: async (ctx) => {} },
 *     ],
 *   }
 *
 * ctx: { bot, message, channel, server, authorId, args, arg, prefix, reply(text) }
 */
export class CommandRouter {
  constructor(bot) {
    this.bot = bot;
    this.modules = [];
    this.commands = new Map();
  }

  use(module) {
    this.modules.push(module);
    for (const cmd of module.commands) {
      for (const key of [cmd.name, ...(cmd.aliases ?? [])]) {
        if (this.commands.has(key)) throw new Error(`Komut çakışması: ${key}`);
        this.commands.set(key, cmd);
      }
    }
    return this;
  }

  helpText() {
    const { prefix } = this.bot.config;
    const sections = this.modules.map((m) => {
      const lines = m.commands
        .filter((c) => !c.hidden)
        .map((c) => `${prefix}${c.name}${c.usage ? " " + c.usage : ""} – ${c.description}`);
      return `**${m.name}**\n${lines.join("\n")}`;
    });
    return sections.join("\n\n");
  }

  async handle(message) {
    const { prefix } = this.bot.config;
    const content = message?.content;
    if (!content?.startsWith(prefix)) return;
    if (message.authorId === this.bot.client.user?.id) return;

    const channel = message.channel;
    if (!channel) return;

    const [name, ...rest] = content.slice(prefix.length).trim().split(/\s+/);
    const cmd = this.commands.get(name?.toLowerCase());
    if (!cmd) return;

    const ctx = {
      bot: this.bot,
      message,
      channel,
      server: message.server ?? channel.server ?? null,
      authorId: message.authorId,
      args: rest,
      arg: rest.join(" ").trim(),
      prefix,
      reply: (text) => say(channel, text),
    };

    try {
      await cmd.run(ctx);
    } catch (e) {
      console.error(`[komut ${name}]`, e);
      await ctx.reply(`⚠️ ${prefix}${name} çalışırken hata oldu: ${shortError(e).slice(0, 120)}`);
    }
  }
}
