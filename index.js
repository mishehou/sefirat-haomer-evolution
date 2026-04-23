require('dotenv').config();
const axios   = require('axios');
const cron    = require('node-cron');
const express = require('express');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { spawn } = require('child_process');
const { getOmerMessage } = require('./omerLogic');

// Latest QR code pushed by Evolution API webhook — served on /setup page
let latestQrBase64 = null;

const TIME_TO_SEND      = process.env.TIME_TO_SEND      || '20:30';
const TIMEZONE          = process.env.TIMEZONE          || 'Europe/Berlin';
const EVOLUTION_URL     = process.env.EVOLUTION_URL     || 'http://omer-evolution-api:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'omer-evo-secret-key';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'sefirat-omer';

const evoHeaders = {
    'apikey': EVOLUTION_API_KEY,
    'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const CONTACTS_FILE = process.env.CONTACTS_FILE || path.join(__dirname, 'targets.json');

function loadTargets() {
    try {
        if (fs.existsSync(CONTACTS_FILE)) {
            const all = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
            const omerTargets = all.filter(c => c.omer);
            if (omerTargets.length > 0 || CONTACTS_FILE.endsWith('contacts.json')) {
                return omerTargets.map(c => ({ label: c.label || c.chatId, chatId: c.chatId }));
            }
        }
    } catch (e) {
        console.error('Could not read contacts file:', e.message);
    }
    return [];
}

// ---------------------------------------------------------------------------
// Generate Omer graphic via Python → returns base64 PNG string
// ---------------------------------------------------------------------------

function generateOmerGraphicBase64() {
    return new Promise((resolve, reject) => {
        const outPath = path.join(os.tmpdir(), `omer_${Date.now()}.png`);
        const proc = spawn('python3', [path.join(__dirname, 'omer_graphic.py'), outPath]);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.stdout.on('data', d => { console.log('[omer_graphic]', d.toString().trim()); });
        proc.on('error', reject);
        proc.on('close', code => {
            if (code !== 0) return reject(new Error(`omer_graphic.py exited ${code}: ${stderr.trim()}`));
            try {
                const data = fs.readFileSync(outPath).toString('base64');
                try { fs.unlinkSync(outPath); } catch (_) {}
                resolve(data);
            } catch (e) { reject(e); }
        });
    });
}

// ---------------------------------------------------------------------------
// Send text via Evolution API
// Evolution chatId format: "972501234567@s.whatsapp.net" or "120363...@g.us"
// Evolution number field strips the @... suffix for personal chats,
// but for groups the full JID is needed.
// ---------------------------------------------------------------------------

function chatIdToNumber(chatId) {
    // Evolution API accepts the full JID directly as the "number" field
    return chatId;
}

async function sendMessage(chatId, label, text) {
    // v1.8.x wraps content in textMessage; v2.x uses flat text field
    const v1Body = { number: chatIdToNumber(chatId), textMessage: { text } };
    const v2Body = { number: chatIdToNumber(chatId), text };
    for (const body of [v1Body, v2Body]) {
        try {
            await axios.post(
                `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
                body,
                { headers: evoHeaders, timeout: 15000 }
            );
            console.log(`Sent text to "${label}" (${chatId})`);
            return true;
        } catch (err) {
            const detail = err.response ? JSON.stringify(err.response.data) : err.message;
            if (err.response?.status === 400 && detail.includes('textMessage')) continue;
            console.error(`Failed to send text to "${label}": ${detail}`);
            return false;
        }
    }
    console.error(`Failed to send text to "${label}": all formats failed`);
    return false;
}

async function sendImage(chatId, label, base64Data, caption = '') {
    // v1.8.x wraps content in mediaMessage; v2.x uses flat fields
    const v1Body = {
        number: chatIdToNumber(chatId),
        mediaMessage: {
            mediatype: 'image',
            mimetype: 'image/png',
            fileName: 'omer.png',
            media: base64Data,
            caption,
        },
    };
    const v2Body = {
        number: chatIdToNumber(chatId),
        mediatype: 'image',
        mimetype: 'image/png',
        fileName: 'omer.png',
        media: base64Data,
        caption,
    };
    for (const body of [v1Body, v2Body]) {
        try {
            await axios.post(
                `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
                body,
                { headers: evoHeaders, timeout: 30000 }
            );
            console.log(`Sent image to "${label}" (${chatId})`);
            return true;
        } catch (err) {
            const detail = err.response ? JSON.stringify(err.response.data) : err.message;
            if (err.response?.status === 400 && detail.includes('mediaMessage')) continue;
            console.error(`Failed to send image to "${label}": ${detail}`);
            return false;
        }
    }
    console.error(`Failed to send image to "${label}": all formats failed`);
    return false;
}

// ---------------------------------------------------------------------------
// Wait until Evolution API instance is connected
// ---------------------------------------------------------------------------

async function waitForEvolution(maxWaitMs = 300000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        try {
            const r = await axios.get(
                `${EVOLUTION_URL}/instance/fetchInstances`,
                { headers: evoHeaders, timeout: 8000 }
            );
            const instances = Array.isArray(r.data) ? r.data : [];
            // v2 API: { name, connectionStatus }  /  v1.8.x API: { instance: { instanceName, state } }
            const inst = instances.find(i =>
                i.name === EVOLUTION_INSTANCE || i.instance?.instanceName === EVOLUTION_INSTANCE
            );

            if (inst) {
                const status = inst.connectionStatus || inst.instance?.state || inst.instance?.status;
                if (status === 'open') {
                    console.log('Evolution API instance is connected.');
                    await registerWebhook();
                    return true;
                }
                console.log(`Evolution instance status: ${status} — scan QR at http://<NAS-IP>:5052/setup`);
            } else {
                console.log('Creating Evolution API instance…');
                await axios.post(
                    `${EVOLUTION_URL}/instance/create`,
                    {
                        instanceName: EVOLUTION_INSTANCE,
                        integration: 'WHATSAPP-BAILEYS',
                        webhook: 'http://sefirat-evo-bot:3500/webhook',
                        webhook_by_events: true,
                        events: ['MESSAGES_UPSERT', 'QRCODE_UPDATED'],
                    },
                    { headers: evoHeaders, timeout: 10000 }
                ).catch(e => console.log('Instance create:', e.response?.data?.message || e.message));
                // Register webhook immediately so QR events are received from the start
                await registerWebhook();
            }
        } catch (err) {
            console.log(`Evolution API not reachable yet: ${err.message}`);
        }
        await new Promise(res => setTimeout(res, 5000));
    }
    console.error('Evolution API did not become ready in time.');
    return false;
}

async function registerWebhook() {
    // v1.8.x format: flat body; v2.x format: nested under 'webhook'
    const v1Body = {
        url: 'http://sefirat-evo-bot:3500/webhook',
        webhook_by_events: true,
        events: ['MESSAGES_UPSERT', 'QRCODE_UPDATED'],
    };
    const v2Body = {
        webhook: {
            enabled: true,
            url: 'http://sefirat-evo-bot:3500/webhook',
            byEvents: true,
            events: ['MESSAGES_UPSERT', 'QRCODE_UPDATED'],
        },
    };
    for (const body of [v1Body, v2Body]) {
        try {
            await axios.post(
                `${EVOLUTION_URL}/webhook/set/${EVOLUTION_INSTANCE}`,
                body,
                { headers: evoHeaders, timeout: 8000 }
            );
            console.log('Webhook registered.');
            return;
        } catch (e) {
            const msg = e.response?.data?.message || e.response?.data?.[0] || e.message;
            console.log('Webhook registration attempt failed:', msg);
        }
    }
}

// ---------------------------------------------------------------------------
// Web server
// ---------------------------------------------------------------------------

function startWebServer() {
    const web = express();
    web.use(express.json());

    // ── QR / connection setup ────────────────────────────────────────────────

    web.get('/setup', async (req, res) => {
        let state = 'waiting';
        let qrHtml = '';
        try {
            const r = await axios.get(`${EVOLUTION_URL}/instance/fetchInstances`,
                { headers: evoHeaders, timeout: 8000 });
            const instances = Array.isArray(r.data) ? r.data : [];
            const inst = instances.find(i =>
                i.name === EVOLUTION_INSTANCE || i.instance?.instanceName === EVOLUTION_INSTANCE
            );
            if (inst) {
                const connStatus = inst.connectionStatus || inst.instance?.state || inst.instance?.status;
                state = connStatus === 'open' ? 'open' : 'qr';
                if (state === 'qr') {
                    // Prefer QR received via webhook; fall back to REST endpoint
                    const base64 = latestQrBase64 || await (async () => {
                        try {
                            const qrRes = await axios.get(
                                `${EVOLUTION_URL}/instance/connect/${EVOLUTION_INSTANCE}`,
                                { headers: evoHeaders, timeout: 8000 });
                            return qrRes.data?.base64 || null;
                        } catch (_) { return null; }
                    })();
                    if (base64) {
                        qrHtml = `<img src="${base64}" style="max-width:280px;border:1px solid #ccc;border-radius:8px;">`;
                    } else {
                        qrHtml = '<p>QR not yet available. Auto-refreshing…</p>';
                    }
                }
            }
        } catch (e) { /* waiting */ }

        let body;
        if (state === 'open') {
            body = `<h2 style="color:green">Connected!</h2>
                    <p>WhatsApp is linked and the bot is ready.</p>
                    <a href="/test" style="display:inline-block;padding:10px 20px;background:#0d6efd;color:white;border-radius:6px;text-decoration:none">Send test message</a>`;
        } else if (state === 'qr') {
            body = `<h2>Scan QR Code</h2>
                    <p>Open WhatsApp → Settings → Linked Devices → Link a Device, then scan:</p>
                    ${qrHtml}
                    <p style="color:#888;font-size:0.85em">QR codes expire. <a href="/setup">Refresh</a> if needed.</p>
                    <meta http-equiv="refresh" content="30">`;
        } else {
            body = `<h2>Waiting for Evolution API…</h2>
                    <p>Still starting up. Auto-refreshing.</p>
                    <meta http-equiv="refresh" content="5">`;
        }

        res.send(`<!doctype html><html><head><meta charset="utf-8">
            <title>Sefirat HaOmer Bot (Evolution)</title>
            <style>body{font-family:sans-serif;max-width:500px;margin:60px auto;text-align:center;background:#f8f9fa}</style>
            </head><body><h1>Sefirat HaOmer Bot</h1><p style="color:#888">(Evolution API edition)</p>${body}</body></html>`);
    });

    // ── Test send ────────────────────────────────────────────────────────────

    web.get('/test', (req, res) => {
        const message = getOmerMessage();
        if (!message) {
            return res.send('Today is not a day of Sefirat HaOmer — no message to send.<br><a href="/setup">Back</a>');
        }
        const targets = loadTargets();
        if (targets.length === 0) {
            return res.send('No Omer targets configured.<br><a href="/setup">Back</a>');
        }
        res.send(`Sending to ${targets.length} target(s)… check server logs for results.<br><a href="/setup">Back</a>`);
        (async () => {
            let imgData = null;
            try { imgData = await generateOmerGraphicBase64(); }
            catch (e) { console.error('Graphic failed, falling back to text:', e.message); }
            for (const t of targets) {
                const sent = imgData && await sendImage(t.chatId, t.label, imgData);
                if (!sent) await sendMessage(t.chatId, t.label, message);
            }
        })();
    });

    // ── Webhook — handle incoming WhatsApp messages ──────────────────────────

    web.post('/webhook', async (req, res) => {
        res.sendStatus(200);
        try {
            const event = req.body;
            // Evolution API wraps events: { event: 'qrcode.updated' | 'messages.upsert', data: { ... } }
            if (event?.event === 'qrcode.updated') {
                const base64 = event.data?.qrcode?.base64;
                if (base64) {
                    latestQrBase64 = base64;
                    console.log('QR code updated via webhook.');
                }
                return;
            }
            if (event?.event !== 'messages.upsert') return;
            const data = event.data;
            const text = (
                data?.message?.conversation ||
                data?.message?.extendedTextMessage?.text || ''
            ).trim();
            const chatId = data?.key?.remoteJid;
            if (!text || !chatId) return;

            if (text === '!test-sefira') {
                console.log('!test-sefira command received');
                const message = getOmerMessage();
                if (!message) {
                    await sendMessage(chatId, chatId, 'Today is currently not a day of Sefirat HaOmer.');
                } else {
                    let sent = false;
                    try {
                        const imgData = await generateOmerGraphicBase64();
                        sent = await sendImage(chatId, chatId, imgData, 'Here is what the bot will send tonight:');
                    } catch (e) {
                        console.error('Graphic failed:', e.message);
                    }
                    if (!sent) await sendMessage(chatId, chatId, 'Here is what the bot will send tonight:\n\n' + message);
                }
            }
        } catch (e) {
            console.error('Webhook error:', e.message);
        }
    });

    web.listen(3500, () => console.log('Web server ready at http://localhost:3500/setup'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    startWebServer();
    console.log('Sefirat HaOmer bot (Evolution API) starting…');
    console.log(`Send time: ${TIME_TO_SEND} (${TIMEZONE})`);

    const ready = await waitForEvolution();
    if (!ready) {
        console.error('Evolution API not ready after timeout — continuing anyway.');
    }

    const [hour, minute] = TIME_TO_SEND.split(':');
    cron.schedule(`${minute} ${hour} * * *`, async () => {
        console.log('Running daily Sefirat HaOmer job…');
        const message = getOmerMessage();
        if (!message) { console.log('Not a day of Sefirat HaOmer.'); return; }
        const targets = loadTargets();
        if (targets.length === 0) { console.log('No targets configured.'); return; }

        let imgData = null;
        try { imgData = await generateOmerGraphicBase64(); }
        catch (e) { console.error('Graphic failed, falling back to text:', e.message); }

        for (const t of targets) {
            const sent = imgData && await sendImage(t.chatId, t.label, imgData);
            if (!sent) await sendMessage(t.chatId, t.label, message);
        }
    }, { scheduled: true, timezone: TIMEZONE });

    console.log('Bot is running. Waiting for scheduled time…');
}

main();
