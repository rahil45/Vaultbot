const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const db     = require('../utils/database');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('Set or view the verification log channel')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set the channel where verification logs will be sent')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('The channel to send logs to')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Disable verification logging')
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View current log channel setting')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const sub   = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ── View ──────────────────────────────────────────────────────────────────
    if (sub === 'view') {
      const cfg = db.getGuildConfig(guild.id);
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Log Channel Settings')
            .addFields(
              {
                name:  '📬 Log Channel',
                value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : '`Not set`',
                inline: true,
              },
              {
                name:  '🎖️ Verified Role',
                value: cfg.verifiedRoleId ? `<@&${cfg.verifiedRoleId}>` : '`Not set`',
                inline: true,
              },
            )
            .setFooter({ text: 'Use /setlogs set to configure a log channel' })
        ]
      });
    }

    // ── Disable ───────────────────────────────────────────────────────────────
    if (sub === 'disable') {
      db.setGuildConfig(guild.id, { logChannelId: null });
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setDescription('🔕 Verification logging has been **disabled**.')
        ]
      });
    }

    // ── Set ───────────────────────────────────────────────────────────────────
    const channel = interaction.options.getChannel('channel');

    // Check bot has permission to send in that channel
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms.has('SendMessages') || !perms.has('EmbedLinks')) {
      return interaction.editReply({
        content: `❌ I don't have **Send Messages** and **Embed Links** permissions in ${channel}. Please fix that first.`
      });
    }

    db.setGuildConfig(guild.id, { logChannelId: channel.id });

    // Send a test log message to confirm it works
    const testEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Log Channel Configured')
      .setDescription(`Verification logs will now appear in this channel.\nHere's what a real log entry looks like:`)
      .setTimestamp();

    await channel.send({ embeds: [testEmbed] });

    // Send a sample verification log so they can preview it
    const sampleLog = new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor({ name: 'ExampleUser#0000 verified', iconURL: 'https://cdn.discordapp.com/embed/avatars/0.png' })
      .setThumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
      .addFields(
        { name: '◦ User',           value: `<@${interaction.user.id}> \`${interaction.user.username}\``, inline: true },
        { name: '◦ User ID',        value: `\`${interaction.user.id}\``,                               inline: true },
        { name: '◦ Role Assigned',  value: '`✅ Verified`',                                            inline: false },
        { name: '◦ Verified At',     value: `<t:${Math.floor(Date.now() / 1000)}:F>`,                  inline: true },
        { name: '◦ Total Verified',  value: '`1` members',                                             inline: true },
      )
      .setFooter({ text: 'VaultBot • Verification Log (Sample)' })
      .setTimestamp();

    await channel.send({ embeds: [sampleLog] });

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('✅ Log Channel Set!')
          .setDescription(`Verification logs will be sent to ${channel}.`)
          .addFields(
            { name: '📬 Channel', value: `${channel}`, inline: true },
            { name: '🔔 Status',  value: '`Active`',   inline: true },
          )
          .setFooter({ text: 'A sample log was sent to the channel so you can preview it' })
      ]
    });
  },
};
