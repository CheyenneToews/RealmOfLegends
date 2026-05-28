const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. Database Initialization
// THE FIX: Use Render's official environment variable to prevent Windows C:\data conflicts
const isRender = process.env.RENDER === 'true';
const dbPath = isRender ? '/data/game_data.db' : './game_data.db';
const db = new sqlite3.Database(dbPath);
db.serialize(() => db.run("CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)"));

const kv = {
  get: (key) => new Promise((res, rej) => db.get("SELECT value FROM kv_store WHERE key = ?", [key], (err, row) => err ? rej(err) : res(row ? JSON.parse(row.value) : null))),
  set: (key, value) => new Promise((res, rej) => db.run("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)", [key, JSON.stringify(value)], (err) => err ? rej(err) : res(true))),
  del: (key) => new Promise((res, rej) => db.run("DELETE FROM kv_store WHERE key = ?", [key], (err) => err ? rej(err) : res(true))),
  getByPrefix: (prefix) => new Promise((res, rej) => db.all("SELECT value FROM kv_store WHERE key LIKE ?", [`${prefix}%`], (err, rows) => err ? rej(err) : res(rows.map(r => JSON.parse(r.value))))),
  getAllKeys: () => new Promise((res, rej) => db.all("SELECT key FROM kv_store", [], (err, rows) => err ? rej(err) : res(rows.map(r => r.key))))
};

// 2. Email Service
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: 'primedchronicoms@gmail.com', pass: 'emimifbxctfmpcjc' }
});

// 3. The Master Auth & Admin Firewall
app.use(async (req, res, next) => {
  req.kv = kv; // Inject Database into every request

  // THE FIX: Enforce Master Directive token parsing
  let token = req.headers['x-user-token'] || (req.headers.authorization || "").split(" ")[1];
  if (token) {
    try {
      if (token.startsWith('{')) {
        const parsed = JSON.parse(token);
        token = parsed.access_token || token;
      }
      const email = Buffer.from(token, 'base64').toString('utf8');
      if (email && email.includes('@')) {
        req.user = { id: `user_${email}`, email: email };
      }
    } catch (e) { }
  }

  // Attach Admin Status
  if (req.user) {
    let admins = await kv.get('rol_admins') || ["cheyennetoews@gmail.com", "primedchronicoms@gmail.com"];
    req.isAdmin = admins.includes(req.user.email);
  }
  next();
});

// 4. Route Delegation
app.use('/', require('./routes/auth')(transporter));
app.use('/', require('./routes/admin')());
app.use('/', require('./routes/store')());
app.use('/', require('./routes/multiplayer')());

app.use((req, res) => res.json({ success: true, dummy: true, data: [] }));

app.listen(PORT, '0.0.0.0', () => console.log(`⚔️ Realm of Legends Modular Server running on port ${PORT}`));