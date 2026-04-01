const express = require("express");
const fs = require("fs").promises;
const { Client, GatewayIntentBits, Partials } = require("discord.js");

const app = express();
app.use(express.json());

// CONFIG
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ID = "841709448338472991";

// DB
let db = {};
let logs = [];

// =========================
// 📂 DB
// =========================
async function loadDB() {
    try {
        const data = await fs.readFile("db.json");
        db = JSON.parse(data);
    } catch {
        db = {};
        await fs.writeFile("db.json", JSON.stringify(db, null, 2));
    }
}

async function saveDB() {
    await fs.writeFile("db.json", JSON.stringify(db, null, 2));
}

loadDB();

// =========================
// 🕒 HORÁRIO
// =========================
function getTime() {
    const d = new Date();
    return `[${d.toLocaleTimeString()}]`;
}

// =========================
// 🧠 LOGS
// =========================
function addLog(message, command) {
    const mention = `<@${message.author.id}>`;
    const text = `${getTime()} O usuário ${mention} usou o comando '${command}'`;

    const entry = { text, time: Date.now() };
    logs.push(entry);

    setTimeout(() => {
        logs = logs.filter(l => l !== entry);
    }, 30 * 60 * 1000);
}

function addExpireLog(username, type) {
    const text = `${getTime()} O VIP da conta '${username}' ${type === "temp" ? "(SIMULADA)" : ""} foi expirado`;

    const entry = { text, time: Date.now() };
    logs.push(entry);

    setTimeout(() => {
        logs = logs.filter(l => l !== entry);
    }, 30 * 60 * 1000);
}

// =========================
// 🔥 WEBHOOK
// =========================
app.post("/webhook", async (req, res) => {
    const { userId, username, key } = req.body;

    if (key !== SECRET_KEY) {
        return res.status(403).send("Acesso negado");
    }

    db[userId] = {
        username,
        vip: true,
        type: "permanent"
    };

    await saveDB();
    res.send("OK");
});

// =========================
// 🤖 DISCORD
// =========================
const client = new Client({
    intents: [GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});

client.once("ready", () => {
    console.log(`🤖 Bot online como ${client.user.tag}`);
});

// =========================
// ⏳ TIME PARSER
// =========================
function parseTime(input) {
    const regex = /(\d+)([hms])/g;
    let total = 0;
    let match;

    while ((match = regex.exec(input)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2];

        if (unit === "h") total += value * 3600;
        if (unit === "m") total += value * 60;
        if (unit === "s") total += value;
    }

    return total;
}

// dividir msg
function splitMessage(text, max = 2000) {
    const arr = [];
    for (let i = 0; i < text.length; i += max) {
        arr.push(text.substring(i, i + max));
    }
    return arr;
}

const activeTests = new Map();

// =========================
// 💬 COMANDOS
// =========================
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const args = content.split(" ");

    // =========================
    // 📜 /cmds
    // =========================
    if (lower === "/cmds") {
        return message.reply(
`Comandos:
"/list": Cita todas as pessoas que tem o VIP..
"/SPurchase [nick] [0h 0m 0s | PERM]"`
        );
    }

    // =========================
    // 📋 /list
    // =========================
    if (lower === "/list") {

        addLog(message, "/list");

        if (Object.keys(db).length === 0) {
            return message.reply("Ninguém tem VIP.");
        }

        let txt = "";
        for (const id in db) {
            txt += `${db[id].username}: tem VIP\n`;
        }

        const parts = splitMessage(txt);

        for (let i = 0; i < parts.length; i++) {
            await message.author.send(parts[i]);
            if (i < parts.length - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    // =========================
    // 🧪 /SPurchase
    // =========================
    if (lower.startsWith("/spurchase")) {

        addLog(message, "/SPurchase");

        const username = args[1];
        const timeInput = args.slice(2).join(" ");

        if (!username || !timeInput) {
            return message.reply('Use: /SPurchase [nick] [tempo]');
        }

        // PERM
        if (timeInput.toUpperCase() === "PERM") {
            db[`perm_${username}`] = {
                username,
                vip: true,
                type: "permanent"
            };

            await saveDB();
            return message.reply(`🔥 ${username} agora tem VIP PERMANENTE`);
        }

        const seconds = parseTime(timeInput);

        if (!seconds) {
            return message.reply('Use: /SPurchase [nick] [tempo]');
        }

        if (seconds > 3600) {
            return message.reply("Máximo: 1 hora.");
        }

        for (const id in db) {
            if (db[id].username === username && db[id].vip) {
                return message.reply("Este usuário já tem VIP.");
            }
        }

        if (activeTests.has(username)) {
            return message.reply("VIP já ativo.");
        }

        db[`test_${username}`] = {
            username,
            vip: true,
            type: "temp"
        };

        await saveDB();

        message.reply(`✅ ${username} recebeu VIP por ${timeInput}`);

        const timeout = setTimeout(async () => {
            delete db[`test_${username}`];
            await saveDB();
            activeTests.delete(username);

            addExpireLog(username, "temp");

            try {
                await message.author.send(`⏳ VIP de ${username} expirou.`);
            } catch {}
        }, seconds * 1000);

        activeTests.set(username, timeout);
    }

    // =========================
    // 🧹 /clear (ADMIN)
    // =========================
    if (lower === "/clear") {
        if (message.author.id !== OWNER_ID) return;

        db = {};
        await saveDB();

        addLog(message, "/clear");

        return message.reply("Todos os VIPs foram apagados.");
    }

    // =========================
    // 📜 /logs (ADMIN)
    // =========================
    if (lower === "/logs") {
        if (message.author.id !== OWNER_ID) return;

        if (logs.length === 0) {
            return message.reply("Sem logs.");
        }

        await new Promise(r => setTimeout(r, 2000));

        await message.channel.send("----------------------- // LOGS //-----------------------");

        let txt = logs.map(l => l.text).join("\n");
        const parts = splitMessage(txt);

        for (let i = 0; i < parts.length; i++) {
            await message.channel.send(parts[i]);

            if (i < parts.length - 1) {
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        await message.channel.send("--------------------------------------------------------");
    }
});

// =========================
// 🚀 START
// =========================
app.listen(PORT, () => {
    console.log("Servidor rodando na porta", PORT);
});

client.login(DISCORD_TOKEN);