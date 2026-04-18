const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;

// Track user state (same concept, new purpose)
const userStates = {}; 

// 📚 Fetch School Data (Menu → School Data)
async function getSchoolData(path) {
    try {
        const response = await fetch(`${FIREBASE_URL}/${path}.json`);
        const data = await response.json();
        return data || {};
    } catch (error) {
        console.error("Firebase Fetch Error:", error);
        return {};
    }
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL is missing!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser:["SchoolBot", "AI", "1"] 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log("Scan QR to login:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') console.log('✅ SCHOOL BOT ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

        console.log(`📩 Query: ${text}`);

        // 🎓 STEP: Admission Form Submit
        if (userStates[sender]?.step === 'WAITING_FOR_ADMISSION') {
            const details = text;

            const admissionData = {
                userId: sender,
                details: details,
                timestamp: new Date().toISOString()
            };

            await fetch(`${FIREBASE_URL}/admissions.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(admissionData)
            });

            await sock.sendMessage(sender, { text: `✅ Admission Request Submitted!\n\nWe will contact you soon.` });
            delete userStates[sender];
            return;
        }

        // 💰 STEP: Fee Payment Info
        if (userStates[sender]?.step === 'WAITING_FOR_FEE_ID') {
            const studentId = text;

            const feesData = await getSchoolData('fees');
            const studentFee = feesData[studentId];

            if (!studentFee) {
                await sock.sendMessage(sender, { text: "❌ Student not found. Try again." });
                return;
            }

            await sock.sendMessage(sender, { 
                text: `💰 Fee Details:\n\nTotal: ₹${studentFee.total}\nPaid: ₹${studentFee.paid}\nPending: ₹${studentFee.pending}\n\nPay via UPI: school@upi` 
            });

            delete userStates[sender];
            return;
        }

        // 📚 Admission Start
        if (text === "admission") {
            userStates[sender] = { step: 'WAITING_FOR_ADMISSION' };

            await sock.sendMessage(sender, { 
                text: "📚 *Admission Form*\n\nSend:\nName, Class, Phone Number, Address" 
            });
        }

        // 💰 Fees Check
        else if (text === "fees") {
            userStates[sender] = { step: 'WAITING_FOR_FEE_ID' };

            await sock.sendMessage(sender, { 
                text: "💰 Enter your Student ID to check fees:" 
            });
        }

        // 📊 Attendance
        else if (text === "attendance") {
            const attendanceData = await getSchoolData('attendance');

            let message = "📊 Attendance:\n\n";
            Object.keys(attendanceData).forEach(id => {
                message += `ID: ${id} → Present: ${attendanceData[id].present}, Absent: ${attendanceData[id].absent}\n`;
            });

            await sock.sendMessage(sender, { text: message });
        }

        // 📢 Notices
        else if (text === "notice") {
            const notices = await getSchoolData('notices');

            let message = "📢 School Notices:\n\n";
            Object.values(notices).forEach(n => {
                message += `🔸 ${n}\n`;
            });

            await sock.sendMessage(sender, { text: message });
        }

        // 👋 Greeting
        else if (text.includes("hi") || text.includes("hello")) {
            await sock.sendMessage(sender, { 
                text: `👋 *Welcome to School AI Bot*\n\nType:\n📚 admission\n💰 fees\n📊 attendance\n📢 notice` 
            });
        }

        // ❓ Default
        else {
            await sock.sendMessage(sender, { 
                text: "❓ Type:\n📚 admission\n💰 fees\n📊 attendance\n📢 notice" 
            });
        }
    });
}

startBot().catch(err => console.log("Error: " + err));
