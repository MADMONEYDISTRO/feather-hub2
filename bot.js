const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');

// ==================== CONFIGURATION ====================
const TOKEN = process.env.DISCORD_TOKEN;
const RENDER_API = 'https://backend-fbzh.onrender.com/validate'; // Your existing server!
const ALLOWED_CHANNEL_ID = process.env.CHANNEL_ID;
// ========================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const app = express();
app.use(express.json());

// Health check endpoint (keeps Render happy)
app.get('/', (req, res) => {
    res.send('🤖 License Bot is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    client.user.setActivity('!license <key>', { type: 2 });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    if (message.content.startsWith('!license')) {
        const args = message.content.split(' ');
        const key = args[1];

        if (!key) {
            return message.reply('❌ Please provide a key: `!license YOUR-KEY`');
        }

        await message.channel.sendTyping();

        try {
            const response = await axios.post(RENDER_API, {
                key: key,
                platform: 'discord-bot',
                username: message.author.username,
                userId: message.author.id
            });

            const result = response.data;

            const embed = new EmbedBuilder()
                .setTitle(result.success ? '✅ License Valid!' : '❌ License Failed')
                .setDescription(result.message || 'Processing...')
                .setColor(result.success ? 0x00FF00 : 0xFF0000)
                .addFields(
                    { name: 'Key', value: `\`${key}\``, inline: true },
                    { name: 'User', value: message.author.username, inline: true }
                )
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            if (result.success) {
                await message.react('✅');
            } else {
                await message.react('❌');
            }

        } catch (error) {
            console.error('API Error:', error.message);
            await message.reply('❌ Error connecting to license server');
        }
    }
});

client.login(TOKEN);
