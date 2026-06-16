const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = "waleed2026kvn";

app.use(express.json({ limit: '50mb' }));
app.use(cors());

const SCRIPTS_FILE = path.join(__dirname, 'scripts.json');
const KEYS_FILE = path.join(__dirname, 'keys.json');

if (!fs.existsSync(SCRIPTS_FILE)) fs.writeFileSync(SCRIPTS_FILE, JSON.stringify({}));
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, JSON.stringify([]));

function readScripts() { return JSON.parse(fs.readFileSync(SCRIPTS_FILE, 'utf8')); }
function writeScripts(data) { fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(data, null, 2)); }
function readKeys() { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); }
function writeKeys(data) { fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2)); }

function checkAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (auth && auth === `Bearer ${ADMIN_TOKEN}`) next();
    else res.status(403).json({ error: 'غير مصرح' });
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/load/:id.lua', (req, res) => {
    const scripts = readScripts();
    const id = req.params.id;
    if (scripts[id]) { res.type('text/plain'); res.send(scripts[id].source); }
    else res.status(404).send('-- not found');
});

app.get('/api/script-status/:id', (req, res) => {
    const scripts = readScripts();
    res.json({ active: scripts[req.params.id]?.active || false });
});

app.post('/api/validate-key', (req, res) => {
    const { key, username } = req.body;
    if (!key || !username) return res.json({ valid: false, message: 'بيانات ناقصة' });
    
    const keys = readKeys();
    const k = keys.find(x => x.key === key);
    
    if (!k) return res.json({ valid: false, message: 'المفتاح غير موجود' });
    if (k.expiryDate && new Date(k.expiryDate) < new Date()) return res.json({ valid: false, message: 'المفتاح منتهي' });
    
    if (k.allowedUsername) {
        if (k.allowedUsername.toLowerCase() !== username.toLowerCase())
            return res.json({ valid: false, message: 'المفتاح مخصص للاعب: ' + k.allowedUsername });
    } else {
        if (k.activatedUsername && k.activatedUsername.toLowerCase() !== username.toLowerCase())
            return res.json({ valid: false, message: 'المفتاح مربوط بحساب آخر' });
        if (!k.activatedUsername) {
            k.activatedUsername = username;
            writeKeys(keys);
        }
    }
    
    res.json({ valid: true, message: '✅ صالح' });
});

app.post('/api/list', checkAuth, (req, res) => res.json(readScripts()));

app.post('/api/upload', checkAuth, (req, res) => {
    const { id, source, type } = req.body;
    if (!id || !source) return res.json({ success: false });
    const scripts = readScripts();
    scripts[id] = { source, type: type || 'free', active: true };
    writeScripts(scripts);
    res.json({ success: true });
});

app.post('/api/toggle', checkAuth, (req, res) => {
    const { id, active } = req.body;
    const scripts = readScripts();
    if (scripts[id]) { scripts[id].active = active; writeScripts(scripts); res.json({ success: true }); }
    else res.json({ success: false });
});

app.post('/api/delete-script', checkAuth, (req, res) => {
    const { id } = req.body;
    const scripts = readScripts();
    if (scripts[id]) {
        delete scripts[id];
        writeScripts(scripts);
        writeKeys(readKeys().filter(k => k.scriptId !== id));
        res.json({ success: true });
    } else res.json({ success: false });
});

app.post('/api/keys/list', checkAuth, (req, res) => {
    const keys = readKeys();
    const now = new Date();
    res.json(keys.map(k => ({ ...k, isExpired: k.expiryDate ? new Date(k.expiryDate) < now : false })));
});

app.post('/api/keys/generate', checkAuth, (req, res) => {
    const { scriptId, duration, allowedUsername } = req.body;
    if (!scriptId) return res.json({ success: false });
    
    const key = 'WALEED-' + Math.random().toString(36).substring(2,8).toUpperCase() + '-' + Math.random().toString(36).substring(2,6).toUpperCase();
    let expiryDate = null;
    if (duration) {
        const m = duration.match(/(\d+)\s*(min|h|d|m|y)/i);
        if (m) {
            const now = new Date();
            const n = parseInt(m[1]);
            const u = m[2].toLowerCase();
            if (u === 'min') now.setMinutes(now.getMinutes()+n);
            if (u === 'h') now.setHours(now.getHours()+n);
            if (u === 'd') now.setDate(now.getDate()+n);
            if (u === 'm') now.setMonth(now.getMonth()+n);
            if (u === 'y') now.setFullYear(now.getFullYear()+n);
            expiryDate = now.toISOString();
        }
    }
    
    const keys = readKeys();
    keys.push({ key, scriptId, duration: duration || 'غير محدد', expiryDate, activatedUsername: null, allowedUsername: allowedUsername || null });
    writeKeys(keys);
    res.json({ success: true, key, expiryDate });
});

app.post('/api/keys/reset', checkAuth, (req, res) => {
    const keys = readKeys();
    const idx = keys.findIndex(k => k.key === req.body.key);
    if (idx !== -1) { keys[idx].activatedUsername = null; writeKeys(keys); res.json({ success: true }); }
    else res.json({ success: false });
});

app.post('/api/keys/delete', checkAuth, (req, res) => {
    writeKeys(readKeys().filter(k => k.key !== req.body.key));
    res.json({ success: true });
});

app.listen(PORT, () => console.log('Waleed Hub running on port ' + PORT));