const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const app = express();
const PORT = 3000;

// قاعدة البيانات
const db = new sqlite3.Database('./waliy_hub.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS scripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        accountName TEXT,
        kickMessage TEXT DEFAULT 'تم طردك من السكربت',
        luaContent TEXT,
        targetUsername TEXT,
        expiryDuration TEXT,
        enabled INTEGER DEFAULT 1,
        expiresAt TIMESTAMP,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        ip TEXT,
        success INTEGER,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS script_accesses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scriptId INTEGER,
        scriptName TEXT,
        ip TEXT,
        blockedReason TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db' }),
    secret: uuidv4(),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const ADMIN_USERNAME = "Waleed";
const ADMIN_PASSWORD = "kvn2026";

// Middleware
function requireAuth(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'يرجى تسجيل الدخول' });
    next();
}

function logAccess(scriptId, scriptName, ip, blockedReason = null) {
    db.run('INSERT INTO script_accesses (scriptId, scriptName, ip, blockedReason) VALUES (?,?,?,?)',
        [scriptId, scriptName, ip, blockedReason]);
}

// Auth
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip;
    const success = (username === ADMIN_USERNAME && password === ADMIN_PASSWORD);
    db.run('INSERT INTO login_attempts (username, ip, success) VALUES (?,?,?)', [username, ip, success ? 1 : 0]);
    if (success) {
        req.session.user = { username };
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, message: 'خطأ في البيانات' });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/auth/me', (req, res) => res.json({ loggedIn: !!req.session.user, username: req.session.user?.username }));

// Scripts CRUD
app.get('/api/scripts', requireAuth, (req, res) => {
    db.all('SELECT * FROM scripts ORDER BY createdAt DESC', (err, rows) => res.json(rows || []));
});

app.post('/api/scripts', requireAuth, (req, res) => {
    const { name, luaContent, targetUsername, expiryDuration, kickMessage } = req.body;
    const accountName = req.session.user.username;
    db.run('INSERT INTO scripts (name, accountName, luaContent, targetUsername, expiryDuration, kickMessage) VALUES (?,?,?,?,?,?)',
        [name, accountName, luaContent, targetUsername || null, expiryDuration || null, kickMessage || 'تم طردك من السكربت'],
        function() { res.json({ success: true, id: this.lastID }); });
});

app.put('/api/scripts/:id', requireAuth, (req, res) => {
    const { name, luaContent, targetUsername, expiryDuration, kickMessage } = req.body;
    db.run('UPDATE scripts SET name=?, luaContent=?, targetUsername=?, expiryDuration=?, kickMessage=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?',
        [name, luaContent, targetUsername, expiryDuration, kickMessage, req.params.id],
        () => res.json({ success: true }));
});

app.delete('/api/scripts/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM scripts WHERE id=?', [req.params.id], () => res.json({ success: true }));
});

app.patch('/api/scripts/:id', requireAuth, (req, res) => {
    const { enabled } = req.body;
    db.run('UPDATE scripts SET enabled=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?', [enabled ? 1 : 0, req.params.id], () => res.json({ success: true }));
});

// Loadstring
app.get('/api/scripts/:id/loadstring', requireAuth, (req, res) => {
    db.get('SELECT * FROM scripts WHERE id=?', [req.params.id], (err, script) => {
        if (!script) return res.status(404).json({ error: 'غير موجود' });
        const loadstring = `loadstring(game:HttpGet("${req.protocol}://${req.get('host')}/api/raw/${script.id}"))()`;
        res.json({ loadstring, encrypted: `-- تشفير Moonveil سيكون هنا\n${loadstring}` });
    });
});

// Polling check
app.get('/api/scripts/check/:id', (req, res) => {
    db.get('SELECT enabled FROM scripts WHERE id=?', [req.params.id], (err, script) => {
        res.json({ enabled: script?.enabled === 1 });
    });
});

// Raw Lua (Roblox only)
app.get('/api/raw/:id', (req, res) => {
    const ua = req.get('User-Agent') || '';
    if (!ua.includes('Roblox')) return res.redirect('/');
    db.get('SELECT * FROM scripts WHERE id=?', [req.params.id], (err, script) => {
        if (!script || !script.enabled) return res.status(404).send('-- سكربت غير موجود أو معطل');
        
        const ip = req.ip;
        logAccess(script.id, script.name, ip);

        let lua = '';
        // فحص اليوزرنيم
        if (script.targetUsername) {
            lua += `local _waliy_player = game:GetService("Players").LocalPlayer
if _waliy_player.Name ~= "${script.targetUsername}" then
    _waliy_player:Kick("${script.kickMessage}")
    return
end\n`;
        }
        // نظام polling
        lua += `local _waliy_checkUrl = "${req.protocol}://${req.get('host')}/api/scripts/check/${script.id}"
local _waliy_kickMsg = "${script.kickMessage}"
task.spawn(function()
    while true do
        local _waliy_success, _waliy_res = pcall(function()
            return game:HttpGet(_waliy_checkUrl)
        end)
        if _waliy_success and _waliy_res then
            local _waliy_data = game:GetService("HttpService"):JSONDecode(_waliy_res)
            if not _waliy_data.enabled then
                game:GetService("Players").LocalPlayer:Kick(_waliy_kickMsg)
            end
        end
        task.wait(5)
    end
end)\n`;
        // كود اللاعب
        lua += script.luaContent;
        res.set('Content-Type', 'text/plain').send(lua);
    });
});

// Logs
app.get('/api/logs/logins', requireAuth, (req, res) => db.all('SELECT * FROM login_attempts ORDER BY createdAt DESC', (e, r) => res.json(r)));
app.get('/api/logs/accesses', requireAuth, (req, res) => db.all('SELECT * FROM script_accesses ORDER BY createdAt DESC', (e, r) => res.json(r)));
app.get('/api/logs/accesses/:scriptId', requireAuth, (req, res) => db.all('SELECT * FROM script_accesses WHERE scriptId=? ORDER BY createdAt DESC', [req.params.scriptId], (e, r) => res.json(r)));

app.listen(PORT, () => console.log(`Waliy Hub running on port ${PORT}`));
