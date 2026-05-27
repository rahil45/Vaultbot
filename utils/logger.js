const db = require('./database');

let _client = null;

/** Call once from bot.js after client is ready */
function setClient(client) {
  _client = client;
}

/**
 * Send a log embed to the guild's configured log channel.
 * @param {string} guildId
 * @param {import('discord.js').EmbedBuilder} embed
 */
async function sendLog(guildId, embed) {
  if (!_client) return;

  const cfg = db.getGuildConfig(guildId);
  if (!cfg.logChannelId) return;

  try {
    const channel = await _client.channels.fetch(cfg.logChannelId);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.warn(`[Logger] Could not send log to channel ${cfg.logChannelId}:`, err.message);
  }
}

module.exports = { setClient, sendLog };
