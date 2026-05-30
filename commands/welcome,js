const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Manage the welcome message system')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Set up welcome messages for new members')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Channel to send welcome messages in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('message')
            .setDescription('Welcome message — use {user} {username} {server} {membercount}')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('title')
            .setDescription('Embed title')
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName('color')
            .setDescription('Embed color hex (e.g. #5865F2)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('show_avatar')
            .setDescription('Show the member\'s avatar in the embed (default: true)')
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o.setName('ping_user')
            .setDescription('Ping the user above the welcome embed (default: true)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('test')
        .setDescription('Preview the welcome message as if you just joined')
    )
    .addSubcommand(sub =>
      sub.setName('config')
        .setDescription('View current welcome message settings')
    )
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Disable welcome messages')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const sub   = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ── /welcome config ───────────────────────────────────────────────────────
    if (sub === 'config') {
      const cfg = db.getGuildConfig(guild.id);
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('👋 Welcome Message Config')
            .addFields(
              { name: '✅ Status',       value: cfg.welcomeChannelId ? '`Active`' : '`Disabled`',                           inline: true },
              { name: '📬 Channel',      value: cfg.welcomeChannelId ? `<#${cfg.welcomeChannelId}>` : '`Not set`',           inline: true },
              { name: '🎨 Color',        value: cfg.welcomeColor ? `\`${cfg.welcomeColor}\`` : '`#5865F2`',                  inline: true },
              { name: '🖼️ Show Avatar',  value: cfg.welcomeAvatar !== false ? '`Yes`' : '`No`',                             inline: true },
              { name: '🔔 Ping User',    value: cfg.welcomePing !== false ? '`Yes`' : '`No`',                               inline: true },
              { name: '📝 Message',      value: cfg.welcomeMessage ? `\`\`\`${cfg.welcomeMessage}\`\`\`` : '`Default`',     inline: false },
            )
            .setFooter({ text: 'Variables: {user} {username} {server} {membercount}' })
        ]
      });
    }

    // ── /welcome disable ──────────────────────────────────────────────────────
    if (sub === 'disable') {
      db.setGuildConfig(guild.id, { welcomeChannelId: null });
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xed4245).setDescription('🔕 Welcome messages have been **disabled**.')]
      });
    }

    // ── /welcome test ─────────────────────────────────────────────────────────
    if (sub === 'test') {
      const cfg = db.getGuildConfig(guild.id);
      if (!cfg.welcomeChannelId) {
        return interaction.editReply({ content: '❌ Welcome not set up yet. Run `/welcome setup` first.' });
      }
      const channel = await guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
      if (!channel) return interaction.editReply({ content: '❌ Welcome channel not found.' });

      await sendWelcomeMessage(channel, interaction.member, guild, cfg);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`✅ Test welcome sent to ${channel}!`)]
      });
    }

    // ── /welcome setup ────────────────────────────────────────────────────────
    const channel    = interaction.options.getChannel('channel');
    const message    = interaction.options.getString('message') || null;
    const title      = interaction.options.getString('title') || null;
    const colorHex   = interaction.options.getString('color') || '#5865F2';
    const showAvatar = interaction.options.getBoolean('show_avatar') ?? true;
    const pingUser   = interaction.options.getBoolean('ping_user') ?? true;

    // Check bot has send perms in that channel
    const perms = channel.permissionsFor(guild.members.me);
    if (!perms.has('SendMessages') || !perms.has('EmbedLinks')) {
      return interaction.editReply({ content: `❌ I need **Send Messages** and **Embed Links** permissions in ${channel}.` });
    }

    db.setGuildConfig(guild.id, {
      welcomeChannelId: channel.id,
      welcomeMessage:   message,
      welcomeTitle:     title,
      welcomeColor:     colorHex,
      welcomeAvatar:    showAvatar,
      welcomePing:      pingUser,
    });

    // Send a test preview immediately
    const cfg = db.getGuildConfig(guild.id);
    await sendWelcomeMessage(channel, interaction.member, guild, cfg);

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('✅ Welcome Messages Enabled!')
          .addFields(
            { name: '📬 Channel',     value: `${channel}`,                              inline: true },
            { name: '🔔 Ping User',   value: pingUser ? '`Yes`' : '`No`',              inline: true },
            { name: '🖼️ Avatar',      value: showAvatar ? '`Shown`' : '`Hidden`',      inline: true },
          )
          .setDescription('A preview was sent to the channel so you can see how it looks.')
          .setFooter({ text: 'Variables you can use: {user} {username} {server} {membercount}' })
      ]
    });
  },
};

// ── Shared welcome message sender ─────────────────────────────────────────────
async function sendWelcomeMessage(channel, member, guild, cfg) {
  const user = member.user;

  // Replace variables
  function parse(text) {
    return text
      .replace(/{user}/g,        `<@${user.id}>`)
      .replace(/{username}/g,    user.username)
      .replace(/{server}/g,      guild.name)
      .replace(/{membercount}/g, guild.memberCount.toString());
  }

  const title   = parse(cfg.welcomeTitle   || `Welcome to ${guild.name}!`);
  const message = parse(cfg.welcomeMessage || `Hey {user}, welcome to **{server}**! You are member **#{membercount}**.\n\nMake sure to read the rules and enjoy your stay!`);

  let color = 0x5865F2;
  try { color = parseInt((cfg.welcomeColor || '#5865F2').replace('#', ''), 16); } catch {}

  const avatarUrl = user.displayAvatarURL({ dynamic: true, size: 256 });
  const guildIcon = guild.iconURL({ dynamic: true }) || null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(message)
    .addFields(
      { name: '・ User ID',    value: `${user.id}`,                              inline: false },
      { name: '・ Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: false },
      
    )
    .setFooter({ text: 'We now have ' + guild.memberCount + ' of total members', iconURL: guildIcon })
    .setTimestamp();

  if (cfg.welcomeAvatar !== false) {
    embed.setThumbnail(avatarUrl);
  }

  const content = cfg.welcomePing !== false ? `<@${user.id}>` : undefined;
  await channel.send({ content, embeds: [embed] });
}

module.exports.sendWelcomeMessage = sendWelcomeMessage;
