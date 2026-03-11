const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');

// ==================== CONFIGURATION ====================
const TOKEN = process.env.DISCORD_TOKEN;
const API_URL = 'https://backend-fbzh.onrender.com'; // Your main server URL
const ALLOWED_CHANNEL_ID = process.env.CHANNEL_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || 'YOUR_STAFF_ROLE_ID'; // Add your staff role ID
const ADMIN_PASSWORD = 'madmoney072'; // Your admin password from the server
// ========================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.send('🤖 License Bot is running! Connected to admin panel.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

client.once('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`🔗 Connected to admin panel: ${API_URL}`);
    client.user.setActivity('!help for commands', { type: 2 });
});

// ==================== CHECK IF USER IS STAFF ====================
function isStaff(member) {
    if (!member) return false;
    return member.roles.cache.has(STAFF_ROLE_ID);
}

// ==================== COMMAND HANDLER ====================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    // ===== PUBLIC COMMAND - Check License =====
    if (command === '!license') {
        const key = args[1];
        if (!key) {
            return message.reply('❌ Please provide a key: `!license YOUR-KEY`');
        }

        await message.channel.sendTyping();

        try {
            // Use your existing validate endpoint
            const response = await axios.post(`${API_URL}/validate`, {
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
                .setFooter({ text: 'License System' })
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

    // ===== STAFF ONLY COMMANDS =====
    if (!isStaff(message.member)) return;

    // !status <key> - Check detailed key status
    if (command === '!status') {
        const key = args[1];
        if (!key) {
            return message.reply('❌ Please provide a key: `!status KEY`');
        }

        await message.channel.sendTyping();

        try {
            const response = await axios.post(`${API_URL}/api/key-status`, {
                adminKey: ADMIN_PASSWORD,
                key: key
            });

            if (!response.data.success) {
                return message.reply(`❌ ${response.data.message}`);
            }

            const data = response.data.status;
            
            const embed = new EmbedBuilder()
                .setTitle(`🔍 Key Status: ${key}`)
                .setColor(data.banned ? 0xFF0000 : (data.bound ? 0x00FF00 : 0xFFFF00))
                .addFields(
                    { name: 'Status', value: data.banned ? '🚫 BANNED' : (data.bound ? '🔒 Bound' : '⚡ Available'), inline: true },
                    { name: 'Binding Method', value: data.bindingMethod || 'None', inline: true },
                    { name: 'Devices', value: `${data.deviceCount}/${data.maxDevices}`, inline: true },
                    { name: 'Note', value: data.note || 'No note', inline: false },
                    { name: 'Expires', value: data.expires || 'Never', inline: true },
                    { name: 'Total Uses', value: data.totalUses.toString(), inline: true }
                )
                .setFooter({ text: 'Staff Only' })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Status Error:', error);
            await message.reply('❌ Error fetching key status');
        }
    }

    // !createkey - Create a new license key
    if (command === '!createkey') {
        // Format: !createkey <note> <maxDevices> <expires>
        // Example: !createkey "VIP User" 2 30
        
        const note = args[1] || 'New key';
        const maxDevices = parseInt(args[2]) || 1;
        const expires = args[3] || 'never';

        await message.channel.sendTyping();

        try {
            const response = await axios.post(`${API_URL}/create-key`, {
                adminKey: ADMIN_PASSWORD,
                prefix: 'VIP',
                maxDevices: maxDevices,
                expires: expires === 'never' ? null : expires,
                note: note,
                createdBy: message.author.username
            });

            if (response.data.success) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ New License Key Created')
                    .setColor(0x00FF00)
                    .addFields(
                        { name: 'Key', value: `\`${response.data.key}\`` },
                        { name: 'Note', value: note },
                        { name: 'Max Devices', value: maxDevices.toString() },
                        { name: 'Expires', value: expires === 'never' ? 'Never' : `${expires} days` },
                        { name: 'Created By', value: message.author.username }
                    )
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
                
                // DM the key to staff
                try {
                    await message.author.send(`🔑 **New Key:** \`${response.data.key}\``);
                } catch (dmError) {
                    // Can't DM, ignore
                }
            } else {
                await message.reply(`❌ Failed to create key: ${response.data.message}`);
            }

        } catch (error) {
            console.error('Create Error:', error);
            await message.reply('❌ Error creating key');
        }
    }

    // !bulkcreate <count> <note> - Create multiple keys
    if (command === '!bulkcreate') {
        const count = parseInt(args[1]) || 5;
        const note = args.slice(2).join(' ') || 'Bulk keys';

        if (count > 20) {
            return message.reply('❌ Maximum 20 keys per bulk creation');
        }

        await message.channel.sendTyping();

        try {
            const response = await axios.post(`${API_URL}/bulk-create-keys`, {
                adminKey: ADMIN_PASSWORD,
                count: count,
                prefix: 'VIP',
                maxDevices: 1,
                expires: null,
                note: note,
                createdBy: message.author.username
            });

            if (response.data.success) {
                const keys = response.data.keys;
                
                const embed = new EmbedBuilder()
                    .setTitle(`📦 ${count} Keys Created`)
                    .setColor(0x00FF00)
                    .addFields(
                        { name: 'Batch Note', value: note },
                        { name: 'Keys', value: keys.map(k => `\`${k}\``).join('\n').substring(0, 1000) }
                    )
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Bulk Create Error:', error);
            await message.reply('❌ Error creating bulk keys');
        }
    }

    // !resetkey <key> - Reset/unbind a key
    if (command === '!resetkey') {
        const key = args[1];
        if (!key) {
            return message.reply('❌ Please provide a key: `!resetkey KEY`');
        }

        try {
            const response = await axios.post(`${API_URL}/reset`, {
                adminKey: ADMIN_PASSWORD,
                licenseKey: key
            });

            if (response.data.success) {
                await message.reply(`✅ Key \`${key}\` has been reset`);
                await message.react('✅');
            } else {
                await message.reply(`❌ ${response.data.message}`);
            }

        } catch (error) {
            console.error('Reset Error:', error);
            await message.reply('❌ Error resetting key');
        }
    }

    // !bankey <key> <reason> - Ban a key
    if (command === '!bankey') {
        const key = args[1];
        const reason = args.slice(2).join(' ') || 'No reason provided';

        if (!key) {
            return message.reply('❌ Please provide a key: `!bankey KEY reason`');
        }

        try {
            const response = await axios.post(`${API_URL}/toggle-ban`, {
                adminKey: ADMIN_PASSWORD,
                licenseKey: key,
                ban: true,
                reason: reason
            });

            if (response.data.success) {
                await message.reply(`✅ Key \`${key}\` has been banned\nReason: ${reason}`);
                await message.react('✅');
            } else {
                await message.reply(`❌ ${response.data.message}`);
            }

        } catch (error) {
            console.error('Ban Error:', error);
            await message.reply('❌ Error banning key');
        }
    }

    // !unbankey <key> - Unban a key
    if (command === '!unbankey') {
        const key = args[1];

        if (!key) {
            return message.reply('❌ Please provide a key: `!unbankey KEY`');
        }

        try {
            const response = await axios.post(`${API_URL}/toggle-ban`, {
                adminKey: ADMIN_PASSWORD,
                licenseKey: key,
                ban: false
            });

            if (response.data.success) {
                await message.reply(`✅ Key \`${key}\` has been unbanned`);
                await message.react('✅');
            } else {
                await message.reply(`❌ ${response.data.message}`);
            }

        } catch (error) {
            console.error('Unban Error:', error);
            await message.reply('❌ Error unbanning key');
        }
    }

    // !stats - Show server statistics
    if (command === '!stats') {
        await message.channel.sendTyping();

        try {
            const response = await axios.get(`${API_URL}/api/discord-stats?adminKey=${ADMIN_PASSWORD}`);

            if (response.data.success) {
                const stats = response.data.stats;
                
                const embed = new EmbedBuilder()
                    .setTitle('📊 License Server Statistics')
                    .setColor(0x3498db)
                    .addFields(
                        { name: 'Total Keys', value: stats.totalKeys.toString(), inline: true },
                        { name: 'Bound Keys', value: stats.boundKeys.toString(), inline: true },
                        { name: 'Available', value: stats.availableKeys.toString(), inline: true },
                        { name: 'Banned', value: stats.bannedKeys.toString(), inline: true },
                        { name: 'Expired', value: stats.expiredKeys.toString(), inline: true },
                        { name: 'Validations', value: stats.totalValidations.toString(), inline: true },
                        { name: 'Last Hour', value: stats.lastHourValidations.toString(), inline: true }
                    )
                    .setFooter({ text: 'Staff Only' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Stats Error:', error);
            await message.reply('❌ Error fetching stats');
        }
    }

    // !recent - Show recent activity
    if (command === '!recent') {
        await message.channel.sendTyping();

        try {
            const response = await axios.get(`${API_URL}/api/discord-activity?adminKey=${ADMIN_PASSWORD}&limit=5`);

            if (response.data.success) {
                const activity = response.data.activity;
                
                const embed = new EmbedBuilder()
                    .setTitle('📋 Recent Activity')
                    .setColor(0x3498db)
                    .setDescription(activity.map(log => 
                        `**${log.key}** - ${log.status} - ${new Date(log.time).toLocaleString()}`
                    ).join('\n') || 'No recent activity')
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Recent Error:', error);
            await message.reply('❌ Error fetching activity');
        }
    }

    // !help - Show all commands
    if (command === '!help') {
        const publicCommands = [
            '`!license <key>` - Check if a license key is valid'
        ];

        const staffCommands = [
            '`!status <key>` - Check detailed key status',
            '`!createkey <note> <devices> <days>` - Create new key',
            '`!bulkcreate <count> <note>` - Create multiple keys',
            '`!resetkey <key>` - Reset/unbind a key',
            '`!bankey <key> <reason>` - Ban a key',
            '`!unbankey <key>` - Unban a key',
            '`!stats` - Show server statistics',
            '`!recent` - Show recent activity'
        ];

        const embed = new EmbedBuilder()
            .setTitle('📚 License Bot Commands')
            .setColor(0x3498db)
            .addFields(
                { name: '📋 Public Commands', value: publicCommands.join('\n') },
                { name: '👑 Staff Commands', value: staffCommands.join('\n') }
            )
            .setFooter({ text: isStaff(message.member) ? 'You are a staff member' : 'You are a regular user' });

        await message.reply({ embeds: [embed] });
    }
});

client.login(TOKEN);
