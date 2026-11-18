const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const fs = require("fs");
const http = require("http");
const config = require("./config");

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ayanoo Bot is Running!");
}).listen(process.env.PORT || 3000);

let db = { points: {} };
if (fs.existsSync("database.json")) { db = JSON.parse(fs.readFileSync("database.json")); }
function saveDb() { fs.writeFileSync("database.json", JSON.stringify(db, null, 2)); }
let activeGames = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) },
        browser: ["Ubuntu", "Chrome", "20.0.0"]
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = "967772270289";
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(`[!] كود ربط البوت الخاص بك: ${code}`);
                console.log(`========================================\n`);
            } catch (err) { console.log("خطأ في طلب الكود:", err); }
        }, 5000);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            if ((lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut) { startBot(); }
        } else if (connection === "open") {
            console.log(`[✓] تم اتصال بوت ${config.botName} بنجاح لصالح نقابة ${config.guildName}!`);
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        const mek = messages[0];
        if (!mek.message) return;
        const mtype = Object.keys(mek.message)[0];
        const body = (mtype === "conversation") ? mek.message.conversation :
                     (mtype === "imageMessage") ? mek.message.imageMessage.caption :
                     (mtype === "extendedTextMessage") ? mek.message.extendedTextMessage.text : "";
        const from = mek.key.remoteJid;
        const sender = mek.key.participant || mek.key.remoteJid;
        const senderNumber = sender.split("@")[0];
        const isOwner = senderNumber === config.ownerNumber;
        const pushName = mek.pushName || "عضو";

        if (!body.startsWith(config.prefix)) {
            if (activeGames[from]) {
                const game = activeGames[from];
                if (body.trim().toLowerCase() === game.answer.toLowerCase()) {
                    db.points[senderNumber] = (db.points[senderNumber] || 0) + 10;
                    saveDb();
                    await sock.sendMessage(from, { text: `🎉 كفو ${pushName}! الإجابة صحيحة وحصلت على 10 نقاط (رصيدك: ${db.points[senderNumber]} نقطة).` }, { quoted: mek });
                    clearTimeout(game.timer);
                    delete activeGames[from];
                }
            }
            return;
        }

        const args = body.slice(config.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const text = args.join(" ");

        if (!db.points[senderNumber]) db.points[senderNumber] = 0;

        switch (command) {
            case "اوامر":
            case "ميو":
                const menuText = `🌊 **قائمة أوامر ${config.botName}** 🌊\n🏰 **نقابة:** ${config.guildName}\n\n✨ **قسم التسلية والفعاليات:**\n• \`.عين\` - لعبة تخمين عين الشخصية\n• \`.شخصية\` - تخمين شخصية الأنمي\n• \`.فانز\` - بطاقة فانز الأنمي\n• \`.نقاطي\` - رصيدك والنقاط\n\n👑 **قسم المشرفين:**\n• \`.منشن\` [رسالتك]\n• \`.طرد\`\n• \`.قفل\` / \`.فتح\`\n\n⚙️ **قسم المطور:**\n• \`.بث\` [النص]\n• \`.سيرفر\`\n\n_صُمم خصيصاً لـ ${config.guildName}_ ♣️`;
                await sock.sendMessage(from, { text: menuText }, { quoted: mek });
                break;
            case "نقاطي":
                await sock.sendMessage(from, { text: `👤 العضو: ${pushName}\n💰 رصيدك في كاستل اوشن: ${db.points[senderNumber]} نقطة` }, { quoted: mek });
                break;
            case "منشن":
                if (!mek.key.participant && !isOwner) return;
                const gm = await sock.groupMetadata(from).catch(() => null);
                if (!gm) return;
                await sock.sendMessage(from, { text: `📢 إعلان النقابة:\n${text || "تنبيه للجميع!"}`, mentions: gm.participants.map(p => p.id) }, { quoted: mek });
                break;
            case "عين":
                if (activeGames[from]) { await sock.sendMessage(from, { text: "⚠️ هناك لعبة جارية بالفعل هنا!" }, { quoted: mek }); return; }
                const eyes = [
                    { name: "باكوغو", img: "https://i.imgur.com/7gK1Z0U.jpeg" },
                    { name: "ساسكي", img: "https://i.imgur.com/y0I09lG.jpeg" },
                    { name: "غوجو", img: "https://i.imgur.com/J3hL52Y.jpeg" }
                ];
                const eSel = eyes[Math.floor(Math.random() * eyes.length)];
                activeGames[from] = { answer: eSel.name, timer: setTimeout(async () => { if(activeGames[from]){ await sock.sendMessage(from, { text: `⏰ انتهى الوقت! الإجابة: *${eSel.name}*` }); delete activeGames[from]; } }, 40000) };
                await sock.sendMessage(from, { image: { url: eSel.img }, caption: "👁️ **لعبة عيون الأنمي!**\nلمن تعود هذه العين؟ اكتب اسم الشخصية بسرعة لفوز بـ 10 نقاط!" }, { quoted: mek });
                break;
            case "شخصية":
                if (activeGames[from]) { await sock.sendMessage(from, { text: "⚠️ هناك لعبة جارية بالفعل هنا!" }, { quoted: mek }); return; }
                const chars = [
                    { name: "ناروتو", img: "https://i.imgur.com/09lGy0I.jpeg" },
                    { name: "توجي", img: "https://i.imgur.com/3hL52YJ.jpeg" },
                    { name: "زورو", img: "https://i.imgur.com/82Z0fEv.jpeg" }
                ];
                const cSel = chars[Math.floor(Math.random() * chars.length)];
                activeGames[from] = { answer: cSel.name, timer: setTimeout(async () => { if(activeGames[from]){ await sock.sendMessage(from, { text: `⏰ انتهى الوقت! الإجابة: *${cSel.name}*` }); delete activeGames[from]; } }, 40000) };
                await sock.sendMessage(from, { image: { url: cSel.img }, caption: "🎭 **تخمين شخصية الأنمي!**\nمن هذه الشخصية؟ اكتب اسمها بسرعة!" }, { quoted: mek });
                break;
            case "فانز":
                const fans = ["فانز متعصب لغوجو 🕶️", "عاشق لأسلوب زورو 🗡️", "أوتاكو مخضرم ⛩️", "ملك استراتيجيات ون بيس 👑"];
                await sock.sendMessage(from, { text: `🃏 **بطاقة فانز الأنمي لـ ${pushName}:**\nلقبك: ${fans[Math.floor(Math.random()*fans.length)]}` }, { quoted: mek });
                break;
            case "سيرفر":
                await sock.sendMessage(from, { text: `🟢 البوت يعمل بكفاءة في نقابة ${config.guildName}` }, { quoted: mek });
                break;
            case "بث":
                if (!isOwner) return;
                if (!text) { await sock.sendMessage(from, { text: "اكتب نص البث بعد الأمر." }, { quoted: mek }); return; }
                await sock.sendMessage(from, { text: `📢 **إعلان الإدارة:**\n${text}` });
                break;
        }
    });
}
startBot();
