require('dotenv').config();
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs   = require('fs');
const path = require('path');

const commands = [];
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(__dirname, 'commands', file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`Queued: /${command.data.name}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log(`\nDeploying ${commands.length} slash command(s)...`);

    // Global commands (may take up to 1 hour to propagate)
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );

    console.log('✅ Slash commands deployed globally!');
    console.log('ℹ️  Note: Global commands can take up to 1 hour to appear.');
    console.log('\nTo deploy to a specific server instantly, run:');
    console.log('  node deploy-commands.js <guild_id>');

  } catch (err) {
    console.error('❌ Deployment failed:', err);
  }
})();
