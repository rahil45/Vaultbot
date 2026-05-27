const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Post the verification panel in a channel')
    .addRoleOption(o =>
      o.setName('verified_role')
        .setDescription('Role to assign when a member verifies (creates one if not provided)')
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to post the panel in (defaults to current)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('title')
        .setDescription('Custom title for the verification embed')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('description')
        .setDescription('Custom description for the verification embed')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('color')
        .setDescription('Embed color hex code (e.g. #5865F2)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild    = interaction.guild;
    const channel  = interaction.options.getChannel('channel') || interaction.channel;
    const title    = interaction.options.getString('title') || `Verify to access ${guild.name}`;
    const desc     = interaction.options.getString('description') ||
      'To gain access to this server, you need to complete a quick verification.\nClick the button below to get started!';
    const colorHex = interaction.options.getString('color') || '#5865F2';

    // ── Handle verified role ──────────────────────────────────────────────────
    let verifiedRole = interaction.options.getRole('verified_role');

    if (!verifiedRole) {
      // Auto-create a "Verified" role if none provided
      try {
        verifiedRole = await guild.roles.create({
          name:        '✅ Verified',
          color:       0x57f287,
          hoist:       false,
          mentionable: false,
          reason:      'VaultBot — auto-created verified role',
        });
      } catch (err) {
        return interaction.editReply({ content: `❌ Could not create verified role: ${err.message}\nPlease create a role manually and pass it with \`verified_role\`.` });
      }
    }

    // Save to guild config so the web callback can assign it
    db.setGuildConfig(guild.id, {
      verifiedRoleId:   verifiedRole.id,
      verifiedRoleName: verifiedRole.name,
    });

    // ── Parse color ───────────────────────────────────────────────────────────
    let color = 0x5865F2;
    try { color = parseInt(colorHex.replace('#', ''), 16); } catch {}

    const clientId    = process.env.CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.REDIRECT_URI);
    const oauthUrl    = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds.join&state=${guild.id}`;

    // ── Build embed ───────────────────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(desc)
      .setColor(color)
      .setFooter({ text: `${guild.name} • Powered by MazorVault`, iconURL: guild.iconURL() })
      .setTimestamp();

    const button = new ButtonBuilder()
      .setLabel('Verify Now')
      .setStyle(ButtonStyle.Link)
      .setURL(oauthUrl)
      .setEmoji('🔗');

    const row = new ActionRowBuilder().addComponents(button);

    // ── Send panel ────────────────────────────────────────────────────────────
    try {
      await channel.send({ embeds: [embed], components: [row] });

      const memberCount = db.getMemberCount(guild.id);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ Verification Panel Posted!')
            .setDescription(`Panel posted in ${channel}`)
            .addFields(
              { name: '🎖️ Verified Role',   value: `${verifiedRole}`,  inline: true },
              { name: '👥 Already Verified', value: `${memberCount}`,   inline: true },
              { name: '📌 Auto-created?',    value: interaction.options.getRole('verified_role') ? 'No (used existing)' : 'Yes', inline: true },
            )
            .setFooter({ text: 'Members will receive the role automatically after verifying' })
        ]
      });
    } catch (err) {
      await interaction.editReply({
        content: `❌ Failed to post panel: ${err.message}\nMake sure I have permission to send messages in ${channel}.`
      });
    }
  },
};
