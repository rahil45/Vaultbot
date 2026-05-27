const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
  ComponentType,
} = require('discord.js');
const { restoreBackup, getBackup, listBackups, listAllBackups } = require('../utils/backup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore')
    .setDescription('Restore a backup onto this server — works with backups from old/deleted servers too')
    .addStringOption(o =>
      o.setName('backup_id')
        .setDescription('Full backup ID from /backup list (e.g. 987654321_1748256420)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('source_guild_id')
        .setDescription('Old server ID — uses its latest backup (alternative to backup_id for recovery)')
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('clear_existing')
        .setDescription('Delete existing channels/roles before restoring — recommended for fresh servers (default: true)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild        = interaction.guild;
    const clearOld     = interaction.options.getBoolean('clear_existing') ?? true;
    let   backupId     = interaction.options.getString('backup_id')?.trim();
    const srcGuildId   = interaction.options.getString('source_guild_id')?.trim();

    // ── Resolve which backup to use ───────────────────────────────────────────
    // Priority: backup_id > source_guild_id > latest backup from ANY guild

    if (!backupId && srcGuildId) {
      // Use latest backup from the specified old guild
      const list = listBackups(srcGuildId);
      if (!list.length) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle('❌ No Backups Found')
              .setDescription(
                `No backups found for server ID \`${srcGuildId}\`.\n\n` +
                `> Make sure the bot was running in that server and auto-backup had time to run.\n` +
                `> Use \`/backup list all:True\` to see ALL available backups.`
              )
          ]
        });
      }
      backupId = list[0].id;
    }

    if (!backupId) {
      // No ID given at all — find the latest backup from any guild
      // Prefer current guild first, fall back to any guild
      const currentGuildBackups = listBackups(guild.id);
      if (currentGuildBackups.length) {
        backupId = currentGuildBackups[0].id;
      } else {
        const allBackups = listAllBackups();
        if (!allBackups.length) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle('❌ No Backups Found Anywhere')
                .setDescription(
                  `No backups exist yet on this bot.\n\n` +
                  `**If this is a fresh install after a server nuke:**\n` +
                  `> Unfortunately the backup files are stored on the bot's host machine.\n` +
                  `> If the host was also lost, the backups are gone.\n` +
                  `> For future protection, consider hosting on a VPS with regular disk backups.\n\n` +
                  `**To create a backup now:**\n> Use \`/backup create\` in any server.`
                )
            ]
          });
        }
        backupId = allBackups[0].id;
      }
    }

    // ── Load the backup ───────────────────────────────────────────────────────
    const backup = getBackup(backupId);
    if (!backup) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('❌ Backup Not Found')
            .setDescription(
              `Backup \`${backupId}\` doesn't exist.\n\n` +
              `Use \`/backup list\` or \`/backup list all:True\` to see all available backup IDs.`
            )
        ]
      });
    }

    const isRecovery = backup.guildId !== guild.id;

    // ── Confirmation ──────────────────────────────────────────────────────────
    const confirmBtn = new ButtonBuilder().setCustomId('restore_yes').setLabel('✅ Yes, Restore').setStyle(ButtonStyle.Danger);
    const cancelBtn  = new ButtonBuilder().setCustomId('restore_no').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary);
    const row        = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(isRecovery ? 0xfaa61a : 0xed4245)
          .setTitle(isRecovery ? '🔄 Confirm Recovery Restore' : '⚠️ Confirm Restore')
          .setDescription(
            (isRecovery
              ? `> ⚠️ **Recovery mode** — restoring from a different server's backup.\n\n`
              : '') +
            (clearOld
              ? `**All existing channels and roles in this server will be deleted** before restoring.\n\n`
              : `Channels and roles will be added on top of existing ones (no deletion).\n\n`) +
            `**This cannot be undone!**`
          )
          .addFields(
            { name: '◦ Backup from',  value: backup.guildName,  inline: true },
            { name: '◦ Restoring to', value: guild.name,        inline: true },
            { name: '◦ Backup date',  value: `<t:${Math.floor(new Date(backup.createdAt).getTime()/1000)}:R>`, inline: false },
            { name: '◦ Roles',        value: `${backup.roles.length}`,    inline: true },
            { name: '◦ Channels',     value: `${backup.channels.length + backup.categories.length}`, inline: true },
            { name: '◦ Backup ID',    value: `\`${backupId}\``, inline: false },
          )
      ],
      components: [row],
    });

    // Wait for confirmation
    let confirmation;
    try {
      confirmation = await interaction.channel.awaitMessageComponent({
        filter: i => i.user.id === interaction.user.id && ['restore_yes', 'restore_no'].includes(i.customId),
        time:   30_000,
        componentType: ComponentType.Button,
      });
    } catch {
      return interaction.editReply({ content: '⏱️ Timed out — no response in 30 seconds.', embeds: [], components: [] });
    }

    if (confirmation.customId === 'restore_no') {
      return confirmation.update({ content: '❌ Restore cancelled.', embeds: [], components: [] });
    }

    await confirmation.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('⏳ Restoring Server...')
          .setDescription('Recreating roles, categories, and channels...\nThis may take a few minutes — please stay in the server.')
      ],
      components: [],
    });

    // ── Run restore ───────────────────────────────────────────────────────────
    try {
      const result  = await restoreBackup(guild, backupId, { clearExisting: clearOld });
      const logText = result.log.join('\n').substring(0, 1000);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ Restore Complete!')
            .setDescription(`**${backup.guildName}** has been fully restored onto **${guild.name}**.`)
            .addFields(
              { name: '📋 Log',          value: logText, inline: false },
            )
            .setFooter({ text: isRecovery ? 'Recovery restore complete — run /pull to bring back your members' : 'Restore complete' })
        ],
        components: [],
      });
    } catch (err) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('❌ Restore Failed')
            .setDescription(`\`${err.message}\`\n\nMake sure the bot has Administrator permissions in this server.`)
        ],
        components: [],
      });
    }
  },
};
