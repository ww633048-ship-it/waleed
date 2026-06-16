const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== الإعدادات ==========
const ADMIN_TOKEN = "waleed2026kvn"; // غيّره لأي توكن قوي

// زيادة الحد الأقصى لحجم الطلب (للكودات الطويلة)
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

// ========== نقطة التحقق من المفتاح (يستخدمها السكربت) ==========
app.post('/api/validate-key', (req, res) => {
    const { key, username } = req.body;
    if (!key || !username) return res.json({ valid: false, message: 'بيانات ناقصة' });

    const keys = readKeys();
    const keyData = keys.find(k => k.key === key);

    if (!keyData) {
        return res.json({ valid: false, message: '⛔ المفتاح غير صالح' });
    }

    // تحقق من الصلاحية الزمنية
    if (keyData.expiryDate && new Date(keyData.expiryDate) < new Date()) {
        return res.json({ valid: false, message: '⏰ المفتاح منتهي الصلاحية' });
    }

    // إذا كان محدد له مستخدم معين
    if (keyData.allowedUsername) {
        if (keyData.allowedUsername.toLowerCase() !== username.toLowerCase()) {
            return res.json({ valid: false, message: '⛔ هذا المفتاح مخصص للاعب: ' + keyData.allowedUsername });
        }
    } else {
        // نظام ربط الحساب الأول
        if (keyData.activatedUsername && keyData.activatedUsername.toLowerCase() !== username.toLowerCase()) {
            return res.json({ valid: false, message: '⛔ المفتاح مربوط بحساب آخر' });
        }
        // أول استخدام: سجل الاسم
        if (!keyData.activatedUsername) {
            keyData.activatedUsername = username;
            writeKeys(keys);
        }
    }

    res.json({ valid: true, message: '✅ المفتاح صالح' });
});

// ========== Routes المحمية (أدمن فقط) ==========
app.post('/api/list', checkAuth, (req, res) => {
    res.json(readScripts());
});

app.post('/api/upload', checkAuth, (req, res) => {
    const { id, source, type } = req.body;
    if (!id || !source) return res.json({ success: false, message: 'املأ الحقول' });
    const scripts = readScripts();
    scripts[id] = { source, type: type || 'free', active: true };
    writeScripts(scripts);
    res.json({ success: true });
});

app.post('/api/get-script-source', checkAuth, (req, res) => {
    const scripts = readScripts();
    const { id } = req.body;
    if (scripts[id]) res.json({ success: true, source: scripts[id].source });
    else res.json({ success: false, message: 'غير موجود' });
});

app.post('/api/toggle', checkAuth, (req, res) => {
    const { id, active } = req.body;
    const scripts = readScripts();
    if (scripts[id]) {
        scripts[id].active = active;
        writeScripts(scripts);
        res.json({ success: true });
    } else res.json({ success: false, message: 'غير موجود' });
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
    } else res.json({ success: false, message: 'غير موجود' });
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
    const { scriptId, duration, allowedUsername } = req.body;
    if (!scriptId) return res.json({ success: false, message: 'اختر سكريبت' });

    const key = 'WALEED-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' +
               Math.random().toString(36).substring(2, 6).toUpperCase();

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

    const newKey = {
        key,
        scriptId,
        duration: duration || 'غير محدد',
        expiryDate,
        activatedUsername: null,
        allowedUsername: allowedUsername || null  // <-- إضافة المستخدم المخصص
    };

    const keys = readKeys();
    keys.push(newKey);
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
    } else res.json({ success: false, message: 'غير موجود' });
});

app.post('/api/keys/reset', checkAuth, (req, res) => {
    const { key } = req.body;
    const keys = readKeys();
    const index = keys.findIndex(k => k.key === key);
    if (index !== -1) {
        keys[index].activatedUsername = null;
        writeKeys(keys);
        res.json({ success: true });
    } else res.json({ success: false, message: 'غير موجود' });
});

app.post('/api/keys/delete', checkAuth, (req, res) => {
    const { key } = req.body;
    let keys = readKeys().filter(k => k.key !== key);
    writeKeys(keys);
    res.json({ success: true });
});

app.listen(PORT, () => console.log('Waleed Hub running on port ' + PORT));
