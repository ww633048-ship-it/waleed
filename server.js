const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== الإعدادات ==========
const ADMIN_TOKEN = "waleed2026kvn"; // غيّره لأي توكن قوي

app.use(cors());
app.use(express.json());

const SCRIPTS_FILE = path.join(__dirname, 'scripts.json');
const KEYS_FILE = path.join(__dirname, 'keys.json');

if (!fs.existsSync(SCRIPTS_FILE)) fs.writeFileSync(SCRIPTS_FILE, JSON.stringify({}));
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, JSON.stringify([]));

function readScripts() { return JSON.parse(fs.readFileSync(SCRIPTS_FILE, 'utf8')); }
function writeScripts(data) { fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(data, null, 2)); }
function readKeys() { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); }
function writeKeys(data) { fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2)); }

// ========== Middleware للتحقق من التوكن ==========
function checkAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (auth && auth === `Bearer ${ADMIN_TOKEN}`) {
        next();
    } else {
        res.status(403).json({ error: 'غير مصرح' });
    }
}

// ========== Routes العامة (بدون توثيق) ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/load/:id.lua', (req, res) => {
    const scripts = readScripts();
    const id = req.params.id;
    if (scripts[id]) {
        res.type('text/plain');
        res.send(scripts[id].source);
    } else {
        res.status(404).send('-- not found');
    }
});

app.get('/api/script-status/:id', (req, res) => {
    const scripts = readScripts();
    const id = req.params.id;
    res.json({ active: scripts[id]?.active || false });
});

// ========== Routes المحمية (أدمن فقط) ==========
app.post('/api/list', checkAuth, (req, res) => {
    res.json(readScripts());
});

app.post('/api/upload', checkAuth, (req, res) => {
    const { id, source, type } = req.body;
    if (!id || !source) return res.json({ success: false });
    const scripts = readScripts();
    scripts[id] = { source, type: type || 'free', active: true };
    writeScripts(scripts);
    res.json({ success: true });
});

app.post('/api/get-script-source', checkAuth, (req, res) => {
    const scripts = readScripts();
    const { id } = req.body;
    if (scripts[id]) res.json({ success: true, source: scripts[id].source });
    else res.json({ success: false });
});

app.post('/api/toggle', checkAuth, (req, res) => {
    const { id, active } = req.body;
    const scripts = readScripts();
    if (scripts[id]) {
        scripts[id].active = active;
        writeScripts(scripts);
        res.json({ success: true });
    } else res.json({ success: false });
});

app.post('/api/delete-script', checkAuth, (req, res) => {
    const { id } = req.body;
    const scripts = readScripts();
    if (scripts[id]) {
        delete scripts[id];
        writeScripts(scripts);
        let keys = readKeys().filter(k => k.scriptId !== id);
        writeKeys(keys);
        res.json({ success: true });
    } else res.json({ success: false });
});

app.post('/api/keys/list', checkAuth, (req, res) => {
    const keys = readKeys();
    const now = new Date();
    const result = keys.map(k => ({
        ...k,
        isExpired: k.expiryDate ? new Date(k.expiryDate) < now : false
    }));
    res.json(result);
});

app.post('/api/keys/generate', checkAuth, (req, res) => {
    const { scriptId, duration } = req.body;
    if (!scriptId) return res.json({ success: false });
    const key = 'KEY-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    let expiryDate = null;
    if (duration) {
        const match = duration.match(/(\d+)\s*(min|h|d|m|y)/i);
        if (match) {
            const now = new Date();
            const num = parseInt(match[1]);
            const unit = match[2].toLowerCase();
            if (unit === 'min') now.setMinutes(now.getMinutes() + num);
            if (unit === 'h') now.setHours(now.getHours() + num);
            if (unit === 'd') now.setDate(now.getDate() + num);
            if (unit === 'm') now.setMonth(now.getMonth() + num);
            if (unit === 'y') now.setFullYear(now.getFullYear() + num);
            expiryDate = now.toISOString();
        }
    }
    const keys = readKeys();
    keys.push({ key, scriptId, duration: duration || 'غير محدد', expiryDate, activatedUsername: null });
    writeKeys(keys);
    res.json({ success: true, key, expiryDate });
});

app.post('/api/keys/update-duration', checkAuth, (req, res) => {
    const { key, duration } = req.body;
    const keys = readKeys();
    const index = keys.findIndex(k => k.key === key);
    if (index !== -1) {
        keys[index].duration = duration;
        writeKeys(keys);
        res.json({ success: true });
    } else res.json({ success: false });
});

app.post('/api/keys/reset', checkAuth, (req, res) => {
    const { key } = req.body;
    const keys = readKeys();
    const index = keys.findIndex(k => k.key === key);
    if (index !== -1) {
        keys[index].activatedUsername = null;
        writeKeys(keys);
        res.json({ success: true });
    } else res.json({ success: false });
});

app.post('/api/keys/delete', checkAuth, (req, res) => {
    const { key } = req.body;
    let keys = readKeys().filter(k => k.key !== key);
    writeKeys(keys);
    res.json({ success: true });
});

app.listen(PORT, () => console.log('Waleed Hub running on port ' + PORT));
