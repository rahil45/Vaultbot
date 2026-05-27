const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
  ComponentType,
} = require('discord.js');
const { pullMembers } = require('../utils/puller');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Pull verified members into this server')
    .addStringOption(o =>
      o.setName('source_guild_id')
        .setDescription('OLD server ID to pull members FROM (use this for recovery after a ban/nuke)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('role_id')
        .setDescription('Role ID to assign to pulled members in this server (optional)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const targetGuild  = interaction.guild;
    const botToken     = process.env.BOT_TOKEN;
    const roleId       = interaction.options.getString('role_id') || null;

    // source_guild_id defaults to current server if not given
    const sourceGuildId = (interaction.options.getString('source_guild_id') || interaction.guild.id).trim();
    const isRecovery    = sourceGuildId !== interaction.guild.id;

    // Check if the bot actually has member data for that source
    const memberCount = db.getMemberCount(sourceGuildId);

    if (!memberCount) {
      const hint = isRecovery
        ? `No verified members found for server ID \`${sourceGuildId}\`.\nDouble-check the old server ID — it must match the server where you originally ran \`/setup\`.`
        : `No verified members yet. Run \`/setup\` in this server first so members can verify.`;
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('❌ No Members Found')
            .setDescription(hint)
        ]
      });
    }

    // Grab source guild name for display (may fail if bot is no longer in it — that's fine)
    let sourceName = `Server \`${sourceGuildId}\``;
    try {
      const sg = await interaction.client.guilds.fetch(sourceGuildId);
      sourceName = sg.name;
    } catch { /* bot was kicked from old server — expected during recovery */ }

    const etaMin = Math.ceil(memberCount * 1.1 / 60);

    // ── Confirmation embed ────────────────────────────────────────────────────
    const confirmBtn = new ButtonBuilder().setCustomId('pull_confirm').setLabel('✅ Start Pull').setStyle(ButtonStyle.Primary);
    const cancelBtn  = new ButtonBuilder().setCustomId('pull_cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary);
    const row        = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(isRecovery ? 0xfaa61a : 0x5865F2)
          .setTitle(isRecovery ? '🔄 Confirm Server Recovery Pull' : '📤 Confirm Member Pull')
          .setDescription(
            (isRecovery
              ? `> ⚠️ **Recovery mode** — pulling from a different server's member list.\n\n`
              : '') +
            `This will pull **${memberCount} verified members** into **${targetGuild.name}**.\n\n` +
            `> ✅ Only members who **consented** via OAuth2 will be pulled.\n` +
            `> 🔒 Uses the official \`guilds.join\` scope — no spam, no abuse.\n` +
            `> ⏱️ Takes ~**${etaMin} minute${etaMin !== 1 ? 's' : ''}** due to Discord rate limits.`
          )
          .addFields(
            { name: '> 📤 Pulling From',  value: sourceName,        inline: false },
            { name: '> 📥 Pulling Into',  value: targetGuild.name,  inline: false },
            { name: '> 👥 Members',       value: `${memberCount}`,  inline: false },
          )
          .setFooter({ text: isRecovery ? 'Recovery mode: source server ID was specified manually' : 'Standard pull from current server' })
      ],
      components: [row],
    });

    // Wait for button
    let confirmation;
    try {
      confirmation = await interaction.channel.awaitMessageComponent({
        filter: i => i.user.id === interaction.user.id && ['pull_confirm', 'pull_cancel'].includes(i.customId),
        time:   30_000,
        componentType: ComponentType.Button,
      });
    } catch {
      return interaction.editReply({ content: '⏱️ Timed out — no response in 30 seconds.', embeds: [], components: [] });
    }

    if (confirmation.customId === 'pull_cancel') {
      return confirmation.update({ content: '❌ Pull cancelled.', embeds: [], components: [] });
    }

    await confirmation.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('⏳ Pulling Members...')
          .setDescription(
            `Pulling **${memberCount} members** into **${targetGuild.name}**...\n` +
            `Running in the background — you'll get a DM with progress updates.`
          )
      ],
      components: [],
    });

    // ── Background pull with DM progress ─────────────────────────────────────
    let lastUpdate = Date.now();

    pullMembers(sourceGuildId, targetGuild.id, botToken, roleId, async (done, total, username) => {
      if (Date.now() - lastUpdate > 30_000) {
        lastUpdate = Date.now();
        const remaining = Math.ceil((total - done) * 1.1 / 60);
        try {
          await interaction.user.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('⏳ Pull In Progress')
                .addFields(
                  { name: '> 📊 Progress',  value: `${done} / ${total} members`, inline: true },
                  { name: '> ⏱️ ETA',       value: `~${remaining} min left`,     inline: true },
                  { name: '> 🔄 Last User', value: username,                     inline: false },
                )
            ]
          });
        } catch {}
      }
    }).then(async result => {
      try {
        await interaction.user.send({
          embeds: [
            new EmbedBuilder()
              .setColor(result.success ? 0x57f287 : 0xed4245)
              .setTitle(result.success ? '✅ Pull Complete!' : '❌ Pull Failed')
              .setDescription(result.error || `Migration into **${targetGuild.name}** finished.`)
              .addFields(
                ...(result.success ? [
                  { name: '> ✅ Pulled',    value: `${result.pulled}`,  inline: true },
                  { name: '> ⏭️ Skipped',  value: `${result.skipped}`, inline: true },
                  { name: '> ❌ Failed',   value: `${result.failed}`,  inline: false },
                  { name: '> 📤 Source',   value: sourceName,          inline: true },
                  { name: '> 📥 Target',   value: targetGuild.name,    inline: true },
                ] : [])
              )
          ]
        });
      } catch {}
    });
  },
};
