const express = require('express');
const crypto = require('crypto');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const app = express();
app.use(express.json());

// ==================== CONFIGURATION ====================
const ADMIN_PASSWORD = 'madmoney072';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_CHANNEL_ID = process.env.CHANNEL_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || 'YOUR_STAFF_ROLE_ID';
// ========================================================

// ==================== PERSISTENT STORAGE ====================
// This fixes the key reverting issue - data stays in memory as long as server runs
let whitelist = {
    "lucky": {
        hwid: null,
        fingerprint: null,
        bindingMethod: null,
        maxDevices: 1,
        note: "Test key for development",
        expires: null,
        createdAt: new Date().toISOString(),
        createdBy: "system",
        lastUsed: null,
        totalUses: 0,
        banned: false,
        devices: []
    },
    "madmoney": {
        hwid: null,
        fingerprint: null,
        bindingMethod: null,
        maxDevices: 1,
        note: "John's personal key",
        expires: null,
        createdAt: new Date().toISOString(),
        createdBy: "system",
        lastUsed: null,
        totalUses: 0,
        banned: false,
        devices: []
    },
    "lessons": {
        hwid: null,
        fingerprint: null,
        bindingMethod: null,
        maxDevices: 2,
        note: "Sarah's key (laptop + phone)",
        expires: "2024-12-31",
        createdAt: new Date().toISOString(),
        createdBy: "system",
        lastUsed: null,
        totalUses: 0,
        banned: false,
        devices: []
    }
};

let blacklist = {};
let usageLog = [];
let staffActions = [];

let stats = {
    totalValidations: 0,
    totalKeysCreated: Object.keys(whitelist).length,
    totalBans: 0,
    peakConcurrent: 0,
    lastHourValidations: 0,
    lastHourReset: new Date()
};
// ========================================================

// ==================== HELPER FUNCTIONS ====================
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

function generateLicenseKey(prefix = 'VIP', length = 4, sections = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = prefix + '-';
    
    for (let s = 0; s < sections; s++) {
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        if (s < sections - 1) result += '-';
    }
    
    return result;
}

function generateBulkKeys(count, prefix = 'VIP', length = 4, sections = 4, maxDevices = 1, expires = null, note = '') {
    const keys = [];
    for (let i = 0; i < count; i++) {
        const newKey = generateLicenseKey(prefix, length, sections);
        keys.push({
            key: newKey,
            details: {
                hwid: null,
                fingerprint: null,
                bindingMethod: null,
                maxDevices: maxDevices,
                note: note ? `${note} #${i+1}` : `Bulk key ${i+1}`,
                expires: expires,
                createdAt: new Date().toISOString(),
                createdBy: "staff",
                lastUsed: null,
                totalUses: 0,
                banned: false,
                devices: []
            }
        });
    }
    return keys;
}
// ========================================================

// ==================== LICENSE VALIDATION ENDPOINT ====================
app.post('/validate', (req, res) => {
    try {
        const { key, hwid, fingerprint, executor, platform, userId, username, ip } = req.body;
        
        stats.totalValidations++;
        stats.lastHourValidations++;
        
        if (new Date() - stats.lastHourReset > 3600000) {
            stats.lastHourValidations = 1;
            stats.lastHourReset = new Date();
        }
        
        console.log(`\n🔍 Validation attempt: ${key}`);
        
        if (whitelist[key] && whitelist[key].banned) {
            usageLog.push({ key, hwid: hwid || fingerprint, status: 'KEY_BANNED', time: new Date(), ip });
            return res.json({ success: false, message: "This license key has been banned" });
        }
        
        if (hwid && blacklist[hwid]) {
            usageLog.push({ key, hwid, status: 'BLACKLISTED_HWID', time: new Date(), ip });
            return res.json({ success: false, message: "This device has been blacklisted" });
        }
        
        if (fingerprint && blacklist[fingerprint]) {
            usageLog.push({ key, fingerprint, status: 'BLACKLISTED_FINGERPRINT', time: new Date(), ip });
            return res.json({ success: false, message: "This device has been blacklisted" });
        }
        
        if (!whitelist[key]) {
            usageLog.push({ key, hwid: hwid || fingerprint, status: 'INVALID_KEY', time: new Date(), ip });
            return res.json({ success: false, message: "Invalid license key" });
        }
        
        const license = whitelist[key];
        
        if (license.expires && new Date(license.expires) < new Date()) {
            usageLog.push({ key, hwid: hwid || fingerprint, status: 'EXPIRED', time: new Date(), ip });
            return res.json({ success: false, message: "This license key has expired" });
        }
        
        license.lastUsed = new Date().toISOString();
        license.totalUses++;
        
        if (license.bindingMethod === null) {
            if (hwid) {
                if (license.maxDevices > 1) {
                    if (!license.devices) license.devices = [];
                    if (license.devices.length < license.maxDevices) {
                        license.devices.push({ hwid, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), platform, executor, userId, username });
                        if (license.devices.length === 1) license.bindingMethod = 'hwid';
                    } else {
                        return res.json({ success: false, message: "Maximum device limit reached" });
                    }
                } else {
                    license.hwid = hwid;
                    license.bindingMethod = 'hwid';
                }
                usageLog.push({ key, hwid, status: 'BOUND_HWID', time: new Date(), ip });
                return res.json({ success: true, message: "License activated!" });
            } else if (fingerprint) {
                if (license.maxDevices > 1) {
                    if (!license.devices) license.devices = [];
                    if (license.devices.length < license.maxDevices) {
                        license.devices.push({ fingerprint, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), platform, executor, userId, username });
                        if (license.devices.length === 1) license.bindingMethod = 'fingerprint';
                    } else {
                        return res.json({ success: false, message: "Maximum device limit reached" });
                    }
                } else {
                    license.fingerprint = fingerprint;
                    license.bindingMethod = 'fingerprint';
                }
                usageLog.push({ key, fingerprint, status: 'BOUND_FINGERPRINT', time: new Date(), ip });
                return res.json({ success: true, message: "License activated!" });
            }
        }
        
        if (license.bindingMethod === 'hwid') {
            if (license.maxDevices > 1) {
                if (license.devices?.some(d => d.hwid === hwid)) {
                    usageLog.push({ key, hwid, status: 'VALID_HWID', time: new Date(), ip });
                    return res.json({ success: true, message: "Access granted" });
                }
            } else if (hwid === license.hwid) {
                usageLog.push({ key, hwid, status: 'VALID_HWID', time: new Date(), ip });
                return res.json({ success: true, message: "Access granted" });
            }
        }
        
        if (license.bindingMethod === 'fingerprint') {
            if (license.maxDevices > 1) {
                if (license.devices?.some(d => d.fingerprint === fingerprint)) {
                    usageLog.push({ key, fingerprint, status: 'VALID_FINGERPRINT', time: new Date(), ip });
                    return res.json({ success: true, message: "Access granted" });
                }
            } else if (fingerprint === license.fingerprint) {
                usageLog.push({ key, fingerprint, status: 'VALID_FINGERPRINT', time: new Date(), ip });
                return res.json({ success: true, message: "Access granted" });
            }
        }
        
        return res.json({ success: false, message: "Access denied" });
        
    } catch (error) {
        console.error("Server error:", error);
        res.json({ success: false, message: "Server error" });
    }
});

// ==================== ADMIN API ENDPOINTS ====================
app.post('/create-key', (req, res) => {
    const { adminKey, prefix, maxDevices, expires, note, createdBy } = req.body;
    
    if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, message: "Unauthorized" });
    }
    
    const newKey = generateLicenseKey(prefix || 'VIP');
    
    let expirationDate = null;
    if (expires && expires !== 'never') {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(expires));
        expirationDate = date.toISOString().split('T')[0];
    }
    
    whitelist[newKey] = {
        hwid: null,
        fingerprint: null,
        bindingMethod: null,
        maxDevices: maxDevices || 1,
        note: note || "New license key",
        expires: expirationDate,
        createdAt: new Date().toISOString(),
        createdBy: createdBy || "staff",
        lastUsed: null,
        totalUses: 0,
        banned: false,
        devices: maxDevices > 1 ? [] : null
    };
    
    stats.totalKeysCreated++;
    staffActions.push({ action: 'KEY_CREATED', key: newKey, performedBy: createdBy || "staff", time: new Date().toISOString() });
    usageLog.push({ key: newKey, status: 'KEY_CREATED', time: new Date() });
    
    res.json({ success: true, message: "Key created", key: newKey });
});

app.post('/reset', (req, res) => {
    const { adminKey, licenseKey } = req.body;
    
    if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, message: "Unauthorized" });
    }
    
    if (whitelist[licenseKey]) {
        const license = whitelist[licenseKey];
        license.hwid = null;
        license.fingerprint = null;
        license.bindingMethod = null;
        license.devices = license.maxDevices > 1 ? [] : null;
        license.lastUsed = null;
        
        staffActions.push({ action: 'KEY_RESET', key: licenseKey, performedBy: "staff", time: new Date().toISOString() });
        res.json({ success: true, message: "Key reset successfully" });
    } else {
        res.json({ success: false, message: "Key not found" });
    }
});

app.post('/toggle-ban', (req, res) => {
    const { adminKey, licenseKey, ban, reason } = req.body;
    
    if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, message: "Unauthorized" });
    }
    
    if (whitelist[licenseKey]) {
        whitelist[licenseKey].banned = ban;
        whitelist[licenseKey].banReason = ban ? reason : null;
        whitelist[licenseKey].bannedAt = ban ? new Date().toISOString() : null;
        
        if (ban) stats.totalBans++;
        
        staffActions.push({ action: ban ? 'KEY_BANNED' : 'KEY_UNBANNED', key: licenseKey, reason, performedBy: "staff", time: new Date().toISOString() });
        res.json({ success: true, message: ban ? "Key banned" : "Key unbanned" });
    } else {
        res.json({ success: false, message: "Key not found" });
    }
});

app.post('/api/key-status', (req, res) => {
    const { adminKey, key } = req.body;
    
    if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, message: "Unauthorized" });
    }
    
    if (!whitelist[key]) {
        return res.json({ success: false, message: "Key not found" });
    }
    
    const license = whitelist[key];
    res.json({
        success: true,
        status: {
            bound: license.bindingMethod !== null,
            bindingMethod: license.bindingMethod || 'unbound',
            hwid: license.hwid || null,
            fingerprint: license.fingerprint || null,
            maxDevices: license.maxDevices,
            deviceCount: license.devices?.length || (license.hwid ? 1 : 0),
            note: license.note,
            expires: license.expires,
            banned: license.banned || false,
            totalUses: license.totalUses || 0,
            lastUsed: license.lastUsed
        }
    });
});

app.get('/api/discord-stats', (req, res) => {
    const { adminKey } = req.query;
    
    if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, message: "Unauthorized" });
    }
    
    const totalKeys = Object.keys(whitelist).length;
    const boundKeys = Object.values(whitelist).filter(l => l.bindingMethod !== null).length;
    const bannedKeys = Object.values(whitelist).filter(l => l.banned).length;
    const expiredKeys = Object.values(whitelist).filter(l => l.expires && new Date(l.expires) < new Date()).length;
    
    res.json({
        success: true,
        stats: {
            totalKeys,
            boundKeys,
            availableKeys: totalKeys - boundKeys,
            bannedKeys,
            expiredKeys,
            totalValidations: stats.totalValidations,
            lastHourValidations: stats.lastHourValidations
        }
    });
});

app.get('/api/discord-activity', (req, res) => {
    const { adminKey, limit = 10 } = req.query;
    
    if (adminKey !== ADMIN_PASSWORD) {
        return res.json({ success: false, message: "Unauthorized" });
    }
    
    const recentLogs = usageLog.slice(-Math.min(limit, 50)).map(log => ({
        key: log.key,
        status: log.status,
        time: log.time,
        ip: log.ip || 'unknown'
    })).reverse();
    
    res.json({ success: true, activity: recentLogs });
});

// ==================== ADMIN WEB PANEL ====================
app.get('/admin', (req, res) => {
    const password = req.query.password;
    
    if (password !== ADMIN_PASSWORD) {
        return res.send('<h1>🔒 Unauthorized</h1><p>Invalid password</p>');
    }
    
    const totalBound = Object.values(whitelist).filter(l => l.bindingMethod !== null).length;
    const totalDevices = Object.values(whitelist).reduce((acc, l) => {
        if (l.devices) return acc + l.devices.length;
        if (l.hwid || l.fingerprint) return acc + 1;
        return acc;
    }, 0);
    
    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>License Admin</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: Arial; background: #0f0f0f; color: #fff; padding: 20px; }
                .container { max-width: 1400px; margin: 0 auto; }
                .header { background: #1a1a1a; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
                h1 { color: #667eea; }
                .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
                .stat-card { background: #1a1a1a; padding: 20px; border-radius: 10px; }
                .stat-value { font-size: 28px; font-weight: bold; color: #667eea; }
                .stat-label { color: #888; font-size: 12px; }
                table { width: 100%; border-collapse: collapse; background: #1a1a1a; border-radius: 10px; overflow: hidden; }
                th { background: #2d2d2d; padding: 12px; text-align: left; }
                td { padding: 12px; border-bottom: 1px solid #333; }
                .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; }
                .bound { background: #10b981; }
                .available { background: #f59e0b; }
                .banned { background: #ef4444; }
                .footer { margin-top: 20px; color: #666; text-align: center; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🔐 License System Admin</h1>
                    <p>Total Keys: ${Object.keys(whitelist).length} | Bound: ${totalBound} | Devices: ${totalDevices}</p>
                </div>
                
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-value">${Object.keys(whitelist).length}</div>
                        <div class="stat-label">Total Keys</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${totalBound}</div>
                        <div class="stat-label">Bound Devices</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${stats.totalValidations}</div>
                        <div class="stat-label">Validations</div>
                    </div>
                </div>
                
                <table>
                    <thead>
                        <tr>
                            <th>Key</th>
                            <th>Status</th>
                            <th>Method</th>
                            <th>Devices</th>
                            <th>Note</th>
                            <th>Expires</th>
                        </tr>
                    </thead>
                    <tbody>
    `;
    
    for (const [key, data] of Object.entries(whitelist)) {
        let statusClass = data.banned ? 'banned' : (data.bindingMethod ? 'bound' : 'available');
        let statusText = data.banned ? 'Banned' : (data.bindingMethod ? 'Bound' : 'Available');
        let deviceCount = data.devices?.length || (data.hwid ? 1 : 0);
        
        html += `
            <tr>
                <td><strong>${key}</strong></td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
                <td>${data.bindingMethod || '—'}</td>
                <td>${deviceCount}/${data.maxDevices}</td>
                <td>${data.note || '—'}</td>
                <td>${data.expires || 'Never'}</td>
            </tr>
        `;
    }
    
    html += `
                    </tbody>
                </table>
                <div class="footer">
                    <p>Last Updated: ${new Date().toLocaleString()}</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    res.send(html);
});

// ==================== DISCORD BOT ====================
if (DISCORD_TOKEN) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers
        ]
    });

    client.once('ready', () => {
        console.log(`✅ Discord Bot logged in as ${client.user.tag}`);
        client.user.setActivity('!help', { type: 2 });
    });

    function isStaff(member) {
        return member?.roles.cache.has(STAFF_ROLE_ID) || false;
    }

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

        const args = message.content.split(' ');
        const command = args[0].toLowerCase();

        if (command === '!license') {
            const key = args[1];
            if (!key) return message.reply('❌ Usage: `!license KEY`');
            
            await message.channel.sendTyping();
            
            const license = whitelist[key];
            const valid = license && !license.banned && (!license.expires || new Date(license.expires) > new Date());
            
            const embed = new EmbedBuilder()
                .setTitle(valid ? '✅ Valid License' : '❌ Invalid License')
                .setColor(valid ? 0x00FF00 : 0xFF0000)
                .addFields(
                    { name: 'Key', value: `\`${key}\``, inline: true },
                    { name: 'Status', value: valid ? 'Active' : 'Invalid/Expired', inline: true }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [embed] });
            await message.react(valid ? '✅' : '❌');
        }

        if (!isStaff(message.member)) return;

        if (command === '!status') {
            const key = args[1];
            if (!key) return message.reply('❌ Usage: `!status KEY`');
            
            const license = whitelist[key];
            if (!license) return message.reply('❌ Key not found');
            
            const embed = new EmbedBuilder()
                .setTitle(`🔍 Key: ${key}`)
                .setColor(license.banned ? 0xFF0000 : (license.bindingMethod ? 0x00FF00 : 0xFFFF00))
                .addFields(
                    { name: 'Status', value: license.banned ? '🚫 BANNED' : (license.bindingMethod ? '🔒 Bound' : '⚡ Available'), inline: true },
                    { name: 'Method', value: license.bindingMethod || 'None', inline: true },
                    { name: 'Devices', value: `${license.devices?.length || (license.hwid ? 1 : 0)}/${license.maxDevices}`, inline: true },
                    { name: 'Note', value: license.note || 'None' },
                    { name: 'Expires', value: license.expires || 'Never', inline: true },
                    { name: 'Uses', value: license.totalUses?.toString() || '0', inline: true }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [embed] });
        }

        if (command === '!stats') {
            const totalKeys = Object.keys(whitelist).length;
            const boundKeys = Object.values(whitelist).filter(l => l.bindingMethod).length;
            
            const embed = new EmbedBuilder()
                .setTitle('📊 Server Stats')
                .setColor(0x3498db)
                .addFields(
                    { name: 'Total Keys', value: totalKeys.toString(), inline: true },
                    { name: 'Bound Keys', value: boundKeys.toString(), inline: true },
                    { name: 'Validations', value: stats.totalValidations.toString(), inline: true }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [embed] });
        }

        if (command === '!help') {
            const embed = new EmbedBuilder()
                .setTitle('📚 Commands')
                .setColor(0x3498db)
                .addFields(
                    { name: 'Public', value: '`!license <key>` - Check a key' },
                    { name: 'Staff', value: '`!status <key>` - Key details\n`!stats` - Server stats' }
                );
            
            await message.reply({ embeds: [embed] });
        }
    });

    client.login(DISCORD_TOKEN);
} else {
    console.log('⚠️ Discord bot disabled - no token provided');
}

// ==================== HOME PAGE ====================
app.get('/', (req, res) => {
    res.send(`
        <h2>✅ Ultimate License System</h2>
        <p>Server is running</p>
        <p><a href="/admin?password=madmoney072">Admin Panel</a></p>
    `);
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📊 Active licenses: ${Object.keys(whitelist).length}`);
    console.log(`🔗 Admin panel: /admin?password=${ADMIN_PASSWORD}`);
});
