const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { createBackup, listBackups, listAllBackups } = require('../utils/backup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Backup or manage server backups')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Manually create a backup of this server right now')
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List backups — shows this server or ALL servers if you need recovery')
        .addStringOption(o =>
          o.setName('guild_id')
            .setDescription('Old server ID to list backups for (leave empty for current server)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('all')
            .setDescription('Show ALL backups from every server (owner only, useful for recovery)')
            .setRequired(false)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const sub   = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ── /backup create ────────────────────────────────────────────────────────
    if (sub === 'create') {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xfaa61a).setDescription('⏳ Creating backup... This may take a moment.')]
      });

      try {
        const backupId = await createBackup(guild);
        const backups  = listBackups(guild.id);
        const backup   = backups[0];

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('✅ Backup Created!')
              .setDescription('Save this backup ID somewhere safe — you need it to restore.')
              .addFields(
                { name: '🔑 Backup ID', value: `\`${backupId}\``,           inline: false },
                { name: '📁 Roles',     value: `${backup.roleCount}`,       inline: true  },
                { name: '📁 Channels',  value: `${backup.channelCount}`,    inline: true  },
                { name: '📅 Created',   value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true },
              )
              .setFooter({ text: 'Auto-backup also runs every 24h automatically' })
          ]
        });
      } catch (err) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌ Backup Failed').setDescription(`\`${err.message}\``)]
        });
      }

    // ── /backup list ──────────────────────────────────────────────────────────
    } else if (sub === 'list') {
      const showAll   = interaction.options.getBoolean('all') || false;
      const guildId   = interaction.options.getString('guild_id')?.trim() || guild.id;
      const isOwner   = interaction.user.id === process.env.OWNER_ID;

      // Gather backups
      let backups;
      let title;

      if (showAll && isOwner) {
        backups = listAllBackups();
        title   = `💾 All Backups — ${backups.length} total`;
      } else {
        backups = listBackups(guildId);
        const isOtherGuild = guildId !== guild.id;
        title   = isOtherGuild
          ? `💾 Backups for old server \`${guildId}\``
          : `💾 Backups for ${guild.name}`;
      }

      if (!backups.length) {
        const hint = guildId !== guild.id
          ? `No backups found for server ID \`${guildId}\`.\n\nMake sure:\n> • The bot was running in that server before it was nuked\n> • Auto-backup had enough time to run at least once\n> • The \`data/backups/\` folder is intact on the host machine`
          : `No backups yet.\n\n> Auto-backup will create one within **24 hours** automatically.\n> Or run \`/backup create\` right now to make one manually.`;
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xfaa61a).setTitle('📭 No Backups Found').setDescription(hint)]
        });
      }

      const fields = backups.slice(0, 10).map((b, i) => ({
        name:  `${i + 1}. ${b.name}${b.auto ? ' 🔄' : ' 📌'}`,
        value: [
          `ID: \`${b.id}\``,
          `📁 ${b.roleCount} roles, ${b.channelCount} channels`,
          `📅 <t:${Math.floor(new Date(b.createdAt).getTime()/1000)}:R>`,
          b.auto ? '*(auto-backup)*' : '*(manual backup)*',
        ].join('\n'),
        inline: false,
      }));

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(title)
            .setDescription('🔄 = auto-backup  •  📌 = manual backup')
            .addFields(fields)
            .setFooter({ text: 'Use /restore backup_id:<ID> to restore any backup onto this server' })
        ]
      });
    }
  },
};
