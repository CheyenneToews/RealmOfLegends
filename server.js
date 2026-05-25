const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// THE GAME MASTER
const ADMIN_EMAIL = "cheyennetoews@gmail.com";

// Middleware - THE ULTIMATE WILDCARD
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

app.post('/admin/adjust-gold', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Unauthorized. Admin only." });

  const { userId, amount } = req.body;
  let currentGold = await kv.get(`rol_premium_gold_${userId}`) || 0;
  currentGold += amount;
  await kv.set(`rol_premium_gold_${userId}`, currentGold);

  console.log(`[ADMIN] Adjusted Premium Gold for ${userId} by ${amount}. Total is now ${currentGold}`);
  res.json({ success: true, premiumGold: currentGold });
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
  let premiumGold = 0;
  if (userId) {
    userVault = await kv.get(`rol_vault_${userId}`) || [];
    premiumGold = await kv.get(`rol_premium_gold_${userId}`) || 0;
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
  res.json({ success: true, store: localStore, premiumGold });
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
// GOOGLE PLAY BILLING / STORE PURCHASES
// ============================================================
app.post('/store/verify-rc-purchase', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { userId, type, goldAmount, transactionId, productId } = req.body;

  if (user.id !== userId) return res.status(403).json({ error: "User ID mismatch" });

  try {
    if (type === "gold" && goldAmount) {
      let currentGold = await kv.get(`rol_premium_gold_${userId}`) || 0;
      currentGold += goldAmount;
      await kv.set(`rol_premium_gold_${userId}`, currentGold);
      console.log(`[STORE] Player ${userId} bought ${goldAmount} Premium Gold via Google Play! (Tx: ${transactionId})`);
    }
    else if (type === "vip") {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      let vipData = await kv.get(`rol_vip_${userId}`) || {
        active: true, tier: "Monthly", lootBoxesUsedThisWeek: 0, totalLootBoxesOpened: 0, loyaltyMonths: 0
      };

      vipData.active = true;
      vipData.expiresAt = expiresAt.toISOString();
      vipData.loyaltyMonths = (vipData.loyaltyMonths || 0) + 1;

      await kv.set(`rol_vip_${userId}`, vipData);
      console.log(`[STORE] Player ${userId} subscribed to VIP via Google Play! (Tx: ${transactionId})`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[STORE] Google Play fulfillment error:", err);
    res.status(500).json({ error: "Failed to fulfill purchase" });
  }
});

// ============================================================
// OFFICIAL LOOT BOX GENERATOR & VAULT MANAGEMENT
// ============================================================
const BASE_LOOT_WEIGHTS = [
  { rarity: "common", weight: 40 },
  { rarity: "uncommon", weight: 30 },
  { rarity: "rare", weight: 20 },
  { rarity: "epic", weight: 8 },
  { rarity: "legendary", weight: 2 },
];

const LOYALTY_BONUS_PER_MONTH = 0.5;
const LOYALTY_MAX_MONTHS = 10;

function rollLootRarity(loyaltyMonths = 0) {
  const months = Math.min(Math.max(loyaltyMonths || 0, 0), LOYALTY_MAX_MONTHS);
  const legendaryBonus = months * LOYALTY_BONUS_PER_MONTH;
  const weights = BASE_LOOT_WEIGHTS.map(w => ({
    rarity: w.rarity,
    weight: w.rarity === "legendary"
      ? w.weight + legendaryBonus
      : w.rarity === "common"
        ? Math.max(w.weight - legendaryBonus, 20)
        : w.weight,
  }));
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let roll = Math.random() * total;
  for (const { rarity, weight } of weights) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  return "common";
}

const LOOT_ITEMS = {
  common: [
    { id: "iron_sword", name: "Iron Sword", emoji: "🗡️", type: "weapon", slot: "mainHand" },
    { id: "leather_armor", name: "Leather Armor", emoji: "🎽", type: "armor", slot: "chest" },
    { id: "leather_boots", name: "Leather Boots", emoji: "👢", type: "armor", slot: "feet" },
    { id: "leather_cap", name: "Leather Cap", emoji: "🎩", type: "armor", slot: "head" },
    { id: "cloth_pants", name: "Cloth Pants", emoji: "👖", type: "armor", slot: "legs" },
    { id: "copper_ring", name: "Copper Ring", emoji: "💍", type: "accessory", slot: "ring1" },
    { id: "wooden_pendant", name: "Wooden Pendant", emoji: "📿", type: "accessory", slot: "amulet" },
    { id: "wooden_shield", name: "Wooden Shield", emoji: "🛡️", type: "armor", slot: "offHand" },
    { id: "health_potion", name: "Health Potion", emoji: "🧪", type: "consumable" },
  ],
  uncommon: [
    { id: "steel_longsword", name: "Steel Longsword", emoji: "⚔️", type: "weapon", slot: "mainHand" },
    { id: "chainmail", name: "Chainmail", emoji: "🎽", type: "armor", slot: "chest" },
    { id: "iron_shield", name: "Iron Shield", emoji: "🛡️", type: "armor", slot: "offHand" },
    { id: "steel_helm", name: "Steel Helm", emoji: "⛑️", type: "armor", slot: "head" },
    { id: "reinforced_greaves", name: "Reinforced Greaves", emoji: "👖", type: "armor", slot: "legs" },
    { id: "ring_of_strength", name: "Ring of Strength", emoji: "💍", type: "accessory", slot: "ring1" },
    { id: "amulet_of_health", name: "Amulet of Health", emoji: "📿", type: "accessory", slot: "amulet" },
    { id: "owlseye_pendant", name: "Owl's Eye Pendant", emoji: "🦉", type: "accessory", slot: "amulet" },
    { id: "greater_health_potion", name: "Greater Health Potion", emoji: "🧪", type: "consumable" },
  ],
  rare: [
    { id: "elven_bow", name: "Elven Bow", emoji: "🏹", type: "weapon", slot: "mainHand" },
    { id: "staff_of_wisdom", name: "Staff of Wisdom", emoji: "🪄", type: "weapon", slot: "mainHand" },
    { id: "arcane_tome", name: "Arcane Tome", emoji: "📖", type: "weapon", slot: "offHand" },
    { id: "circlet_of_insight", name: "Circlet of Insight", emoji: "👑", type: "accessory", slot: "head" },
    { id: "swiftstrider_pants", name: "Swiftstrider Pants", emoji: "👖", type: "armor", slot: "legs" },
    { id: "boots_of_haste", name: "Boots of Haste", emoji: "👢", type: "armor", slot: "feet" },
    { id: "ring_of_protection", name: "Ring of Protection", emoji: "💍", type: "accessory", slot: "ring1" },
    { id: "moonstone_circlet", name: "Moonstone Circlet", emoji: "🌙", type: "accessory", slot: "head" },
    { id: "deaths_door_charm", name: "Death's Door Charm", emoji: "📿", type: "accessory", slot: "amulet" },
  ],
  epic: [
    { id: "shadow_dagger", name: "Shadow Dagger", emoji: "🗡️", type: "weapon", slot: "mainHand" },
    { id: "flame_brand", name: "Flame Brand", emoji: "🔥", type: "weapon", slot: "mainHand" },
    { id: "frostbite_staff", name: "Frostbite Staff", emoji: "❄️", type: "weapon", slot: "mainHand" },
    { id: "venomfang_bow", name: "Venomfang Bow", emoji: "🏹", type: "weapon", slot: "mainHand" },
    { id: "dragonscale_vest", name: "Dragonscale Vest", emoji: "🐉", type: "armor", slot: "chest" },
    { id: "mirror_shield", name: "Mirror Shield", emoji: "🪞", type: "armor", slot: "offHand" },
    { id: "wardens_bulwark", name: "Warden's Bulwark", emoji: "🛡️", type: "armor", slot: "offHand" },
    { id: "dark_ritual_cowl", name: "Dark Ritual Cowl", emoji: "🦇", type: "armor", slot: "head" },
    { id: "shadowweave_leggings", name: "Shadowweave Leggings", emoji: "👖", type: "armor", slot: "legs" },
    { id: "stormtouched_greaves", name: "Stormtouched Greaves", emoji: "⚡", type: "armor", slot: "feet" },
    { id: "signet_of_kings", name: "Signet of Kings", emoji: "💍", type: "accessory", slot: "ring1" },
    { id: "band_of_shadows", name: "Band of Shadows", emoji: "💍", type: "accessory", slot: "ring1" },
    { id: "ring_of_defiance", name: "Ring of Defiance", emoji: "💍", type: "accessory", slot: "ring1" },
    { id: "talisman_of_the_wild", name: "Talisman of the Wild", emoji: "🦌", type: "accessory", slot: "amulet" },
  ],
  legendary: [
    { id: "worldsplitter", name: "Worldsplitter", emoji: "🪓", type: "weapon", slot: "mainHand" },
    { id: "crown_of_the_lich", name: "Crown of the Lich", emoji: "👑", type: "accessory", slot: "head" },
    { id: "phoenix_pendant", name: "Phoenix Pendant", emoji: "📿", type: "accessory", slot: "amulet" },
  ],
};

app.post('/store/open-lootbox', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  let vipData = await kv.get(`rol_vip_${user.id}`);
  if (!vipData || !vipData.active) return res.status(403).json({ error: "VIP Required to open boxes." });

  if ((vipData.lootBoxesUsedThisWeek || 0) >= 10) {
    return res.status(400).json({ error: "No boxes remaining this week!" });
  }

  // Deduct the box
  vipData.lootBoxesUsedThisWeek = (vipData.lootBoxesUsedThisWeek || 0) + 1;
  vipData.totalLootBoxesOpened = (vipData.totalLootBoxesOpened || 0) + 1;
  await kv.set(`rol_vip_${user.id}`, vipData);

  // OFFICIAL REWARD GENERATOR
  const loyaltyMonths = vipData.loyaltyMonths || 0;
  const rarity = rollLootRarity(loyaltyMonths);
  const possibleItems = LOOT_ITEMS[rarity] || LOOT_ITEMS.common;
  const item = possibleItems[Math.floor(Math.random() * possibleItems.length)];

  // Add to the player's vault
  let userVault = await kv.get(`rol_vault_${user.id}`) || [];
  userVault.push({ id: item.id, acquiredAt: new Date().toISOString() });
  await kv.set(`rol_vault_${user.id}`, userVault);

  res.json({ success: true, loot: { rarity, item } });
});

app.get('/store/vault', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  let userVault = await kv.get(`rol_vault_${user.id}`) || [];
  const allLoot = Object.values(LOOT_ITEMS).flat();

  const populatedVault = userVault.map((savedItem, index) => {
    const itemData = allLoot.find(i => i.id === savedItem.id) || { name: "Unknown Item", emoji: "📦", type: "item" };
    return {
      ...itemData,
      id: savedItem.id, // The raw ID
      _uid: `${savedItem.id}-${savedItem.acquiredAt}-${index}` // Unique ID for React & Deletion
    };
  });

  res.json({ success: true, vault: populatedVault });
});

app.post('/store/delete-item', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { itemId } = req.body;

  let userVault = await kv.get(`rol_vault_${user.id}`) || [];
  const index = userVault.findIndex(v => v.id === itemId);
  if (index !== -1) {
    userVault.splice(index, 1);
    await kv.set(`rol_vault_${user.id}`, userVault);
  }
  res.json({ success: true });
});

// ============================================================
// ASSET STORAGE (Maps & Images)
// ============================================================
app.get('/assets/game-map-urls', async (req, res) => {
  try {
    const assets = await kv.getByPrefix('rol_asset_');
    const urls = {};
    assets.forEach(a => {
      if (a.assetKey && a.assetKey.startsWith('map_')) {
        urls[a.assetKey] = a.base64Data;
      }
    });
    res.json({ success: true, urls });
  } catch (e) {
    res.status(500).json({ error: "Failed to load maps" });
  }
});

app.post('/assets/upload', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Unauthorized. Admin only." });

  const { assetKey, base64Data } = req.body;
  if (!assetKey || !base64Data) return res.status(400).json({ error: "Missing image data" });

  await kv.set(`rol_asset_${assetKey}`, { assetKey, base64Data, uploadedAt: new Date().toISOString() });
  res.json({ success: true, url: base64Data });
});

app.post('/assets/upload-bulk', async (req, res) => {
  const user = getAuthUser(req);
  if (!user || user.email !== ADMIN_EMAIL) return res.status(403).json({ error: "Unauthorized. Admin only." });

  const { assets } = req.body;
  if (!Array.isArray(assets)) return res.status(400).json({ error: "Invalid bulk data" });

  const results = [];
  for (const asset of assets) {
    try {
      await kv.set(`rol_asset_${asset.assetKey}`, {
        assetKey: asset.assetKey,
        base64Data: asset.base64Data,
        uploadedAt: new Date().toISOString()
      });
      results.push({ assetKey: asset.assetKey, success: true });
    } catch (e) {
      results.push({ assetKey: asset.assetKey, success: false, error: e.message });
    }
  }
  res.json({ success: true, results });
});

// ============================================================
// FRIENDS & CHAT SYSTEM
// ============================================================
app.get('/friends/search', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const query = (req.query.q || "").toLowerCase();

  const allUsers = await kv.getByPrefix('user_');
  const results = allUsers
    .filter(u => u.id !== user.id && (u.email.toLowerCase().includes(query) || (u.displayName && u.displayName.toLowerCase().includes(query))))
    .map(u => ({ id: u.id, display_name: u.displayName }));

  res.json({ success: true, users: results });
});

app.post('/friends/request', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { receiverId } = req.body;

  const friendshipId = `friend_${Date.now()}`;
  const friendship = {
    id: friendshipId,
    requester_id: user.id,
    receiver_id: receiverId,
    status: 'pending',
    created_at: new Date().toISOString()
  };

  await kv.set(`rol_friendship_${friendshipId}`, friendship);
  res.json({ success: true, friendship });
});

app.get('/friends/list', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const allFriendships = await kv.getByPrefix('rol_friendship_');
  const myFriendships = allFriendships.filter(f => f.requester_id === user.id || f.receiver_id === user.id);

  for (const f of myFriendships) {
    const friendId = f.requester_id === user.id ? f.receiver_id : f.requester_id;
    const friendRecord = await kv.get(friendId);
    if (friendRecord) {
      f.friend_profile = { id: friendRecord.id, display_name: friendRecord.displayName };
    }
  }

  res.json({ success: true, friendships: myFriendships });
});

app.post('/friends/accept', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { friendshipId } = req.body;

  let friendship = await kv.get(`rol_friendship_${friendshipId}`);
  if (friendship && friendship.receiver_id === user.id) {
    friendship.status = 'accepted';
    await kv.set(`rol_friendship_${friendshipId}`, friendship);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Invalid request" });
  }
});

app.delete('/friends/:id', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  await kv.del(`rol_friendship_${req.params.id}`);
  res.json({ success: true });
});

app.get('/friends/chat/:friendId', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const friendId = req.params.friendId;

  const convoId = [user.id, friendId].sort().join('_');
  const chatHistory = await kv.get(`rol_chat_${convoId}`) || [];

  res.json({ success: true, messages: chatHistory });
});

app.post('/friends/chat', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { receiverId, content } = req.body;

  const convoId = [user.id, receiverId].sort().join('_');
  let chatHistory = await kv.get(`rol_chat_${convoId}`) || [];

  const newMessage = {
    id: `msg_${Date.now()}`,
    sender_id: user.id,
    receiver_id: receiverId,
    content: content,
    created_at: new Date().toISOString()
  };

  chatHistory.push(newMessage);
  await kv.set(`rol_chat_${convoId}`, chatHistory);

  res.json({ success: true, message: newMessage });
});

app.get('/texture-tuner', (req, res) => res.json({ success: true, value: null }));
app.get('/custom-maps/list', (req, res) => res.json({ success: true, maps: [] }));
app.get('/admin/ban-check/:userId', async (req, res) => {
  const userRecord = await kv.get(req.params.userId);
  res.json({ banned: userRecord ? userRecord.banned : false, reason: userRecord ? userRecord.banReason : null });
});

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
  res.json({ success: true, saveId });
});

app.get('/list-saves', async (req, res) => {
  const saves = await kv.getByPrefix('rol_save_index_');
  res.json({ success: true, saves });
});

app.get('/load-game/:saveId', async (req, res) => {
  const saveData = await kv.get(`rol_save_${req.params.saveId}`);
  if (!saveData) return res.status(404).json({ error: "Save not found" });
  res.json({ success: true, saveData });
});

app.delete('/delete-save/:saveId', async (req, res) => {
  await kv.del(`rol_save_${req.params.saveId}`);
  await kv.del(`rol_save_index_${req.params.saveId}`);
  res.json({ success: true });
});

// ============================================================
// MULTIPLAYER LOBBIES & TACTICAL INITIATIVE WEGO POLLING
// ============================================================
app.post('/sessions/create', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { sessionName, maxPlayers } = req.body;
  const sessionId = `mp_${Date.now()}`;

  const session = {
    id: sessionId, name: sessionName || `${user.email.split("@")[0]}'s Game`,
    hostId: user.id, maxPlayers: maxPlayers || 4,
    players: [{ userId: user.id, email: user.email, isHost: true, joinedAt: new Date().toISOString() }],
    status: "lobby", turnCount: 0,

    // WEGO INITIATIVE SYSTEM
    initiativeOrder: [],
    planningIndex: 0,
    ghostActions: {},

    actionLog: [], chatMessages: [],
    createdAt: new Date().toISOString()
  };
  await kv.set(`rol_session_${sessionId}`, session);
  await kv.set(`rol_session_idx_${sessionId}`, { id: sessionId, name: session.name, status: "lobby", playerCount: 1, maxPlayers: session.maxPlayers, createdAt: session.createdAt });
  console.log(`[MULTIPLAYER] Lobby Created: ${sessionId}`);
  res.json({ success: true, sessionId, session });
});

app.get('/sessions', async (req, res) => {
  const sessions = await kv.getByPrefix("rol_session_idx_");
  const active = sessions.filter(s => s.status === "lobby" || s.status === "active");
  res.json({ success: true, sessions: active });
});

app.get('/sessions/:sessionId', async (req, res) => {
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  if (!session) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, session });
});

app.post('/sessions/:sessionId/join', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  if (!session) return res.status(404).json({ error: "Not found" });
  if (!session.players.find(p => p.userId === user.id)) {
    session.players.push({ userId: user.id, email: user.email, isHost: false, joinedAt: new Date().toISOString() });
    await kv.set(`rol_session_${session.id}`, session);

    const idx = await kv.get(`rol_session_idx_${session.id}`);
    if (idx) {
      idx.playerCount = session.players.length;
      await kv.set(`rol_session_idx_${session.id}`, idx);
    }
  }
  res.json({ success: true, session });
});

app.post('/sessions/:sessionId/start', async (req, res) => {
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  session.status = "active";
  session.turnCount = 1;

  // THE WEGO FIX: ROLL D20 INITIATIVE!
  const rolls = session.players.map(p => ({
    userId: p.userId,
    roll: Math.floor(Math.random() * 20) + 1
  })).sort((a, b) => a.roll - b.roll); // Lowest rolls first (blind), highest rolls last (perfect info)

  session.initiativeOrder = rolls;
  session.planningIndex = 0;
  session.ghostActions = {};

  await kv.set(`rol_session_${session.id}`, session);
  await kv.set(`rol_session_idx_${session.id}`, { id: session.id, status: "active" });
  res.json({ success: true, session });
});

app.post('/sessions/:sessionId/action', async (req, res) => {
  const user = getAuthUser(req);
  const { action, stateSnapshot, ghostPath } = req.body;
  const session = await kv.get(`rol_session_${req.params.sessionId}`);

  const actionEntry = { playerId: user.id, action, seq: session.actionLog.length };
  session.actionLog.push(actionEntry);

  if (action.type === "END_TURN") {
    // 1. SAVE THE GHOST PATH FOR OTHERS TO SEE
    if (!session.ghostActions) session.ghostActions = {};
    session.ghostActions[user.id] = ghostPath || [];

    // 2. ADVANCE THE PLANNING QUEUE
    session.planningIndex = (session.planningIndex || 0) + 1;

    if (stateSnapshot) {
      if (!session.playerStates) session.playerStates = {};
      session.playerStates[user.id] = { snapshot: stateSnapshot, turnCount: session.turnCount };
    }

    // 3. IF EVERYONE HAS LOCKED IN, EXECUTE THE TURN AND REROLL!
    if (session.planningIndex >= session.players.length) {
      session.turnCount += 1;

      // Reroll initiative for the new turn
      const rolls = session.players.map(p => ({
        userId: p.userId,
        roll: Math.floor(Math.random() * 20) + 1
      })).sort((a, b) => a.roll - b.roll);

      session.initiativeOrder = rolls;
      session.planningIndex = 0;

      // Do NOT clear ghost actions immediately here, let the clients fetch them once so they can physically move the tokens,
      // but log that the turn actually advanced.
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
    success: true,
    actions: session.actionLog.filter(a => a.seq >= since),

    // THE WEGO FIX: Expose the Initiative Queue to the UI
    initiativeOrder: session.initiativeOrder || [],
    planningIndex: session.planningIndex || 0,
    ghostActions: session.ghostActions || {},

    turnCount: session.turnCount,
    status: session.status,
    players: session.players,
    playerStates: session.playerStates || {},
    chatMessages: session.chatMessages || [],
    competitiveMode: session.competitiveMode || false
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

app.post('/sessions/:sessionId/leave', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  if (session) {
    session.players = session.players.filter(p => p.userId !== user.id);
    await kv.set(`rol_session_${req.params.sessionId}`, session);

    const idx = await kv.get(`rol_session_idx_${req.params.sessionId}`);
    if (idx) {
      idx.playerCount = session.players.length;
      await kv.set(`rol_session_idx_${req.params.sessionId}`, idx);
    }
  }
  res.json({ success: true });
});

app.post('/sessions/:sessionId/disband', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const session = await kv.get(`rol_session_${req.params.sessionId}`);
  if (session && session.hostId === user.id) {
    await kv.del(`rol_session_${req.params.sessionId}`);
    await kv.del(`rol_session_idx_${req.params.sessionId}`);
  }
  res.json({ success: true });
});

app.delete('/sessions/:sessionId', async (req, res) => {
  await kv.del(`rol_session_${req.params.sessionId}`);
  await kv.del(`rol_session_idx_${req.params.sessionId}`);
  res.json({ success: true });
});

app.use((req, res) => {
  res.json({ success: true, dummy: true, data: [] });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚔️ Realm of Legends Custom Server running on port ${PORT}`);
});