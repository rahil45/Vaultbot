const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('members')
    .setDescription('View verified member stats for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild   = interaction.guild;
    const members = db.getMembersForGuild(guild.id);

    if (!members.length) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfaa61a)
            .setDescription('No verified members yet. Use `/setup` to post a verification panel.')
        ]
      });
    }

    const recent = members
      .sort((a, b) => b.verifiedAt - a.verifiedAt)
      .slice(0, 5)
      .map((m, i) => `${i + 1}. **${m.username}** — <t:${Math.floor(m.verifiedAt / 1000)}:R>`)
      .join('\n');

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`👥 Verified Members — ${guild.name}`)
          .addFields(
            { name: '✅ Total Verified', value: `${members.length} / ${guild.memberCount}`, inline: true },
            { name: '📅 Latest Verify',  value: `<t:${Math.floor(members[0]?.verifiedAt / 1000)}:R>`, inline: true },
            { name: '🕑 Recently Verified', value: recent, inline: false },
          )
          .setFooter({ text: 'Use /pull to migrate members • /setup to post panel' })
      ]
    });
  },
};
