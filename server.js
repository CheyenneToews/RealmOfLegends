const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// THE GAME MASTER
const ADMIN_EMAIL = "cheyennetoews@gmail.com";

// Middleware - THE ULTIMATE WILDCARD
// Leaving cors() empty automatically reflects and approves ANY header or origin the phone sends!
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============================================================
// SQLITE KEY-VALUE STORE
// ============================================================
const db = new sqlite3.Database('./game_data.db');

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)");
});

const kv = {
  get: (key) => new Promise((resolve, reject) => {
    db.get("SELECT value FROM kv_store WHERE key = ?", [key], (err, row) => {
      if (err) reject(err);
      else resolve(row ? JSON.parse(row.value) : null);
    });
  }),
  set: (key, value) => new Promise((resolve, reject) => {
    db.run("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)", [key, JSON.stringify(value)], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  }),
  del: (key) => new Promise((resolve, reject) => {
    db.run("DELETE FROM kv_store WHERE key = ?", [key], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  }),
  getByPrefix: (prefix) => new Promise((resolve, reject) => {
    db.all("SELECT value FROM kv_store WHERE key LIKE ?", [`${prefix}%`], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => JSON.parse(r.value)));
    });
  }),
  getAllKeys: () => new Promise((resolve, reject) => {
    db.all("SELECT key FROM kv_store", [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.key));
    });
  })
};

// ============================================================
// LOCAL USER TRACKING SYSTEM
// ============================================================
async function trackUser(email, displayName = null) {
  const userId = `user_${email}`;
  let userRecord = await kv.get(userId);
  const isGameMaster = email === ADMIN_EMAIL;

  if (!userRecord) {
    userRecord = {
      id: userId,
      email: email,
      displayName: displayName || email.split('@')[0],
      createdAt: new Date().toISOString(),
      lastSignIn: new Date().toISOString(),
      emailConfirmed: true,
      vipActive: isGameMaster,
      vipExpiresAt: null,
      totalLootBoxes: isGameMaster ? 99 : 0,
      banned: false,
      banReason: null,
      purchasedSkins: 0
    };
    console.log(`[DATABASE] New local account registered: ${email}`);

    if (isGameMaster) {
      await kv.set(`rol_vip_${userId}`, {
        active: true, tier: "Grandmaster", lootBoxesUsedThisWeek: 0,
        totalLootBoxesOpened: 0, loyaltyMonths: 12, grantedAt: new Date().toISOString()
      });
      console.log(`[VIP] Granted permanent Grandmaster status to ${email}`);
    }
  } else {
    userRecord.lastSignIn = new Date().toISOString();
  }

  await kv.set(userId, userRecord);
  return userRecord;
}

// ============================================================
// SUPABASE AUTH IMPOSTER
// ============================================================
app.post('/auth/v1/token', async (req, res) => {
  const email = req.body?.email || "local@player.com";
  const token = Buffer.from(email).toString('base64');
  await trackUser(email);
  console.log(`[AUTH] Player logged in: ${email}`);
  res.json({
    access_token: token, token_type: "bearer", expires_in: 360000, refresh_token: token,
    user: { id: `user_${email}`, aud: "authenticated", role: "authenticated", email: email }
  });
});

app.post('/auth/v1/signup', async (req, res) => {
  const email = req.body?.email || "local@player.com";
  const name = req.body?.name || email.split('@')[0];
  const token = Buffer.from(email).toString('base64');
  await trackUser(email, name);
  console.log(`[AUTH] New Player created account: ${email}`);
  res.json({
    access_token: token, token_type: "bearer", expires_in: 360000, refresh_token: token,
    user: { id: `user_${email}`, aud: "authenticated", role: "authenticated", email: email }
  });
});

app.get('/auth/v1/user', (req, res) => {
  const token = (req.headers.authorization || "").split(" ")[1] || "";
  const email = Buffer.from(token, 'base64').toString('utf8') || "local@player.com";
  res.json({ id: `user_${email}`, aud: "authenticated", role: "authenticated", email: email });
});

function getAuthUser(req) {
  const token = req.headers['x-user-token'] || (req.headers.authorization || "").split(" ")[1];
  if (!token) return null;
  const email = Buffer.from(token, 'base64').toString('utf8');
  return { id: `user_${email}`, email: email };
}

// ============================================================
// ADMIN & VIP SYSTEM
// ============================================================

app.get('/admin/check', (req, res) => {
  const user = getAuthUser(req);
  const isAdmin = user && user.email === ADMIN_EMAIL;
  res.json({ success: true, isAdmin: isAdmin });
});

app.get('/admin/stats', async (req, res) => {
  const users = await kv.getByPrefix('user_');
  const activeVips = users.filter(u => u.vipActive).length;
  const activeBans = users.filter(u => u.banned).length;
  res.json({
    success: true,
    stats: { totalUsers: users.length, activeVips, activeBans, totalPurchases: 0, activeSessions: 0 }
  });
});

app.get('/admin/users', async (req, res) => {
  const users = await kv.getByPrefix('user_');
  res.json({ success: true, users });
});

app.get('/admin/activity-log', (req, res) => {
  res.json({ success: true, log: [] });
});

app.get('/admin/list-admins', (req, res) => {
  res.json({ success: true, admins: [ADMIN_EMAIL] });
});

// --- REPORTS MODULE ROUTES ---
app.get('/admin/reports/players', async (req, res) => {
  const reports = await kv.getByPrefix('rol_preport_');
  res.json({ success: true, reports });
});

app.get('/admin/reports/bugs', async (req, res) => {
  const bugs = await kv.getByPrefix('rol_bug_');
  res.json({ success: true, bugs });
});

app.post('/admin/reports/players/status', async (req, res) => {
  const { reportId, status } = req.body;
  let report = await kv.get(`rol_preport_${reportId}`);
  if (report) {
    report.status = status;
    await kv.set(`rol_preport_${reportId}`, report);
  }
  res.json({ success: true });
});

app.post('/admin/reports/bugs/status', async (req, res) => {
  const { bugId, status } = req.body;
  let bug = await kv.get(`rol_bug_${bugId}`);
  if (bug) {
    bug.status = status;
    await kv.set(`rol_bug_${bugId}`, bug);
  }
  res.json({ success: true });
});

app.post('/reports/bugs', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { reporter_id, reporter_name, title, description, severity } = req.body;
  const bugId = `bug_${Date.now()}`;

  const bug = {
    id: bugId,
    reporter_id: reporter_id || user.id,
    reporter_name: reporter_name || user.email.split('@')[0],
    title,
    description,
    severity,
    status: 'open',
    created_at: new Date().toISOString()
  };

  await kv.set(`rol_bug_${bugId}`, bug);
  console.log(`[BUG REPORT] New bug logged by ${bug.reporter_name}: ${title}`);
  res.json({ success: true, bugId });
});

// --- AI SCRIPTS ROUTES ---
app.get('/ai-scripts/list', async (req, res) => {
  const guestId = req.query.guestId || "admin";
  const scripts = await kv.getByPrefix(`rol_ai_${guestId}_`);
  res.json({ success: true, scripts });
});

app.post('/ai-scripts/save', async (req, res) => {
  const { script, guestId } = req.body;
  if (!script || !script.id) return res.status(400).json({ error: "Missing script data" });
  const gid = guestId || "admin";
  await kv.set(`rol_ai_${gid}_${script.id}`, script);
  res.json({ success: true });
});

app.delete('/ai-scripts/:id', async (req, res) => {
  const guestId = req.query.guestId || "admin";
  await kv.del(`rol_ai_${guestId}_${req.params.id}`);
  res.json({ success: true });
});

// --- CAMPAIGNS ROUTES ---
app.get('/campaigns/list', async (req, res) => {
  const ownerId = req.query.userId || req.query.guestId || "anonymous";
  const campaigns = await kv.getByPrefix(`rol_camp_${ownerId}_`);
  res.json({ success: true, campaigns });
});

app.post('/campaigns/save', async (req, res) => {
  const { campaign, userId, guestId } = req.body;
  if (!campaign || !campaign.id) return res.status(400).json({ error: "Missing data" });
  const ownerId = userId || guestId || "anonymous";
  await kv.set(`rol_camp_${ownerId}_${campaign.id}`, campaign);
  res.json({ success: true });
});

app.delete('/campaigns/:id', async (req, res) => {
  const ownerId = req.query.userId || req.query.guestId || "anonymous";
  await kv.del(`rol_camp_${ownerId}_${req.params.id}`);
  res.json({ success: true });
});

// --- ADMIN ACTIONS ---
app.post('/admin/toggle-vip', async (req, res) => {
  const { userId, active } = req.body;
  let userRecord = await kv.get(userId);
  if (userRecord) {
    userRecord.vipActive = active;
    await kv.set(userId, userRecord);
  }
  if (active) {
    await kv.set(`rol_vip_${userId}`, { active: true, tier: "Grandmaster", lootBoxesUsedThisWeek: 0, totalLootBoxesOpened: 0, loyaltyMonths: 1, grantedAt: new Date().toISOString() });
  } else {
    await kv.del(`rol_vip_${userId}`);
  }
  console.log(`[ADMIN] VIP status for ${userId} set to ${active}`);
  res.json({ success: true });
});

app.post('/admin/toggle-ban', async (req, res) => {
  const { userId, banned, reason } = req.body;
  let userRecord = await kv.get(userId);
  if (userRecord) {
    userRecord.banned = banned;
    userRecord.banReason = reason;
    await kv.set(userId, userRecord);
  }
  console.log(`[ADMIN] Ban status for ${userId} set to ${banned}`);
  res.json({ success: true });
});

app.post('/admin/action', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Unauthorized." });
  const { action, targetUserId, amount } = req.body;
  if (action === "grant_gold") {
    let goldData = await kv.get(`rol_gold_adj_${targetUserId}`) || { totalAdjusted: 0, lastClaimedTotal: 0 };
    goldData.totalAdjusted += (amount || 1000);
    await kv.set(`rol_gold_adj_${targetUserId}`, goldData);
    console.log(`[ADMIN] Granted ${amount || 1000} gold to ${targetUserId}`);
  }
  res.json({ success: true });
});

app.post('/store/dev-grant-vip', async (req, res) => {
  const { userId } = req.body;
  await kv.set(`rol_vip_${userId}`, { active: true, tier: "Dev", lootBoxesUsedThisWeek: 0, totalLootBoxesOpened: 0, loyaltyMonths: 5, grantedAt: new Date().toISOString() });
  res.json({ success: true });
});

app.get('/store/vip-status', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json({ success: true, vipStatus: null });
  const vipData = await kv.get(`rol_vip_${userId}`);
  res.json({ success: true, vipStatus: vipData || null });
});

app.get('/admin/gold/:userId', async (req, res) => {
  const goldData = await kv.get(`rol_gold_adj_${req.params.userId}`);
  res.json({ success: true, goldAdjustment: goldData || { totalAdjusted: 0, lastClaimedTotal: 0 } });
});

app.post('/admin/gold/:userId/claim', async (req, res) => {
  const { claimedTotal } = req.body;
  let goldData = await kv.get(`rol_gold_adj_${req.params.userId}`);
  if (goldData) {
    goldData.lastClaimedTotal = claimedTotal;
    await kv.set(`rol_gold_adj_${req.params.userId}`, goldData);
  }
  res.json({ success: true });
});

// ============================================================
// STORE INVENTORY
// ============================================================
app.get('/store/inventory', async (req, res) => {
  const user = getAuthUser(req);
  const userId = user ? user.id : null;

  let userVault = [];
  if (userId) {
    userVault = await kv.get(`rol_vault_${userId}`) || [];
  }
  const ownedItems = userVault.map(v => v.id);

  const localStore = {
    lastRefresh: Date.now(),
    dailyDeals: [
      { id: "skin_raven_lord", name: "Raven Lord Armor", type: "skin", price: 500, currency: "gold", rarity: "legendary" },
      { id: "item_relic_forge_hammer", name: "Forge Master's Hammer", type: "item", price: 250, currency: "gold", rarity: "epic" }
    ],
    lootBoxes: 10,
    purchasedSkins: ownedItems.filter(id => id.startsWith('skin_')),
    unlockedClasses: ownedItems.filter(id => id.startsWith('class_')),
    unlockedRaces: ownedItems.filter(id => id.startsWith('race_')),
    purchasedItems: ownedItems,
    ownedItems: ownedItems
  };
  res.json({ success: true, store: localStore });
});

app.post('/store/buy', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { itemId, price } = req.body;
  let userVault = await kv.get(`rol_vault_${user.id}`) || [];
  userVault.push({ id: itemId, acquiredAt: new Date().toISOString() });
  await kv.set(`rol_vault_${user.id}`, userVault);
  res.json({ success: true, message: "Item purchased successfully!" });
});

// ============================================================
// DUMMY CATCH-ALLS (Silences frontend 404/telemetry errors)
// ============================================================
app.get('/texture-tuner', (req, res) => res.json({ success: true, value: null }));
app.get('/custom-maps/list', (req, res) => res.json({ success: true, maps: [] }));
app.get('/admin/ban-check/:userId', async (req, res) => {
  const userRecord = await kv.get(req.params.userId);
  res.json({ banned: userRecord ? userRecord.banned : false, reason: userRecord ? userRecord.banReason : null });
});

// CRASH-PROOF: Middleware handle for Supabase REST API requests cleanly
app.use('/rest/v1', (req, res) => res.json([]));

// ============================================================
// SAVE / LOAD SYSTEM
// ============================================================
app.post('/save-game', async (req, res) => {
  const { saveId, saveData } = req.body;
  if (!saveId || !saveData) return res.status(400).json({ error: "Missing data" });
  await kv.set(`rol_save_${saveId}`, saveData);
  await kv.set(`rol_save_index_${saveId}`, {
    saveId, characterName: saveData.character?.name || "Unknown",
    level: saveData.character?.level || 1, turnCount: saveData.turnCount || 1,
    savedAt: new Date().toISOString(),
  });
  console.log(`[SAVE] Game saved locally: ${saveId}`);
  res.json({ success: true, saveId });
});

app.get('/list-saves', async (req, res) => {
  const saves = await kv.getByPrefix('rol_save_index_');
  res.json({ success: true, saves });
});

app.get('/load-game/:saveId', async (req, res) => {
  const saveData = await kv.get(`rol_save_${req.params.saveId}`);
  if (!saveData) return res.status(404).json({ error: "Save not found" });
  console.log(`[LOAD] Game loaded locally: ${req.params.saveId}`);
  res.json({ success: true, saveData });
});

app.delete('/delete-save/:saveId', async (req, res) => {
  await kv.del(`rol_save_${req.params.saveId}`);
  await kv.del(`rol_save_index_${req.params.saveId}`);
  res.json({ success: true });
});

// ============================================================
// MULTIPLAYER LOBBIES & WEGO POLLING
// ============================================================
app.post('/sessions/create', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { sessionName, maxPlayers } = req.body;
  const sessionId = `mp_${Date.now()}`;
  const session = {
    id: sessionId, name: sessionName || `${user.email.split("@")[0]}'s Game`,
    hostId: user.id, maxPlayers: maxPlayers || 4,
    players: [{ userId: user.id, email: user.email, isHost: true }],
    status: "lobby", turnCount: 0, currentPlayerIndex: 0, actionLog: [], chatMessages: []
  };
  await kv.set(`rol_session_${sessionId}`, session);
  await kv.set(`rol_session_idx_${sessionId}`, { id: sessionId, status: "lobby", playerCount: 1 });
  console.log(`[MULTIPLAYER] Lobby Created: ${sessionId}`);
  res.json({ success: true, sessionId, session });
});

app.get('/sessions', async (req, res) => {
  const sessions = await kv.getByPrefix("rol_session_idx_");
  const active = sessions.filter(s => s.status === "lobby" || s.status === "active");
  res.json({ success: true, sessions: active });
});

app.post('/sessions/:sessionId/join', async (req, res) => {
  const user = getAuthUser(req);
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  if (!session) return res.status(404).json({ error: "Not found" });
  if (!session.players.find(p => p.userId === user.id)) {
    session.players.push({ userId: user.id, email: user.email, isHost: false });
    await kv.set(`rol_session_${session.id}`, session);
  }
  res.json({ success: true, session });
});

app.post('/sessions/:sessionId/start', async (req, res) => {
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  session.status = "active"; session.turnCount = 1;
  await kv.set(`rol_session_${session.id}`, session);
  await kv.set(`rol_session_idx_${session.id}`, { id: session.id, status: "active" });
  res.json({ success: true, session });
});

app.post('/sessions/:sessionId/action', async (req, res) => {
  const user = getAuthUser(req);
  const { action, stateSnapshot } = req.body;
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  const actionEntry = { playerId: user.id, action, seq: session.actionLog.length };
  session.actionLog.push(actionEntry);
  if (action.type === "END_TURN") {
    session.currentPlayerIndex = (session.currentPlayerIndex + 1) % session.players.length;
    session.turnCount += 1;
    if (stateSnapshot) {
      if (!session.playerStates) session.playerStates = {};
      session.playerStates[user.id] = { snapshot: stateSnapshot, turnCount: session.turnCount - 1 };
    }
  }
  await kv.set(`rol_session_${session.id}`, session);
  res.json({ success: true, session });
});

app.get('/sessions/:sessionId/poll', async (req, res) => {
  const since = parseInt(req.query.since || "0", 10);
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  if (!session) return res.status(404).json({ error: "Not found" });
  res.json({
    success: true, actions: session.actionLog.filter(a => a.seq >= since),
    currentPlayerIndex: session.currentPlayerIndex, turnCount: session.turnCount,
    status: session.status, players: session.players, playerStates: session.playerStates || {},
    chatMessages: session.chatMessages || [], competitiveMode: session.competitiveMode || false
  });
});

app.post('/sessions/:sessionId/chat', async (req, res) => {
  const user = getAuthUser(req);
  const { message } = req.body;
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  session.chatMessages.push({
    playerId: user.id, playerName: user.email.split('@')[0], message, turn: session.turnCount
  });
  await kv.set(`rol_session_${session.id}`, session);
  res.json({ success: true });
});

app.put('/sessions/:sessionId/settings', async (req, res) => {
  const { competitiveMode } = req.body;
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  if (session) {
    session.competitiveMode = !!competitiveMode;
    await kv.set(`rol_session_${session.id}`, session);
    res.json({ success: true, competitiveMode: session.competitiveMode });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

// ============================================================
// THE ULTIMATE CATCH-ALL (CRASH-PROOF EXPRESS 5 WAY)
// ============================================================
app.use((req, res) => {
  // Just silently accept any rogue requests (like telemetry or old supabase pings)
  res.json({ success: true, dummy: true, data: [] });
});

// START SERVER
app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚔️ Realm of Legends Custom Server running on port ${PORT}`);
});