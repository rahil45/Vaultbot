const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vaults')
    .setDescription('List all servers that have verified member tokens saved — use IDs for /pull recovery')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Owner-only
    if (interaction.user.id !== process.env.OWNER_ID) {
      return interaction.editReply({ content: '❌ Only the bot owner can use this command.' });
    }

    const guilds = db.listGuildsWithMembers();

    if (!guilds.length) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfaa61a)
            .setDescription('No verified members saved yet. Run `/setup` in a server first.')
        ]
      });
    }

    // Try to resolve guild names for ones the bot is still in
    const fields = [];
    for (const g of guilds) {
      let name = 'Unknown (bot no longer in server)';
      try {
        const guild = await interaction.client.guilds.fetch(g.guildId);
        name = guild.name;
      } catch {}

      const cfg = db.getGuildConfig(g.guildId);
      fields.push({
        name: name,
        value:
          `🆔 Guild ID: \`${g.guildId}\`\n` +
          `👥 Verified members: **${g.count}**\n` +
          `📅 Last verify: <t:${Math.floor(g.latest / 1000)}:R>\n` +
          `🎖️ Verified role: ${cfg.verifiedRoleId ? `\`${cfg.verifiedRoleId}\`` : '`not set`'}\n` +
          `📬 Log channel: ${cfg.logChannelId ? `\`${cfg.logChannelId}\`` : '`not set`'}`,
        inline: false,
      });
    }

    const total = guilds.reduce((sum, g) => sum + g.count, 0);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`🗄️ Saved Vaults (${guilds.length} server${guilds.length !== 1 ? 's' : ''})`)
          .setDescription(
            `**${total} total verified members** across all servers.\n\n` +
            `To recover a server, run:\n` +
            `\`/pull source_guild_id:<Guild ID>\`\n` +
            `from your **new server** after adding the bot.`
          )
          .addFields(fields.slice(0, 10))
          .setFooter({ text: 'Tokens are encrypted at rest • Members consented via OAuth2' })
      ]
    });
  },
};
