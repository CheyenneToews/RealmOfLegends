const express = require('express');

module.exports = () => {
  const router = express.Router();

  const BASE_LOOT_WEIGHTS = [
    { rarity: "common", weight: 40 }, { rarity: "uncommon", weight: 30 },
    { rarity: "rare", weight: 20 }, { rarity: "epic", weight: 8 }, { rarity: "legendary", weight: 2 },
  ];

  function rollLootRarity(loyaltyMonths = 0) {
    const legendaryBonus = Math.min(Math.max(loyaltyMonths || 0, 0), 10) * 0.5;
    const weights = BASE_LOOT_WEIGHTS.map(w => ({
      rarity: w.rarity, weight: w.rarity === "legendary" ? w.weight + legendaryBonus : w.rarity === "common" ? Math.max(w.weight - legendaryBonus, 20) : w.weight,
    }));
    let roll = Math.random() * weights.reduce((s, w) => s + w.weight, 0);
    for (const { rarity, weight } of weights) { roll -= weight; if (roll <= 0) return rarity; }
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

  router.get('/store/vip-status', async (req, res) => {
    if (!req.query.userId) return res.json({ success: true, vipStatus: null });
    res.json({ success: true, vipStatus: await req.kv.get(`rol_vip_${req.query.userId}`) || null });
  });

  router.get('/store/inventory', async (req, res) => {
    const userId = req.user ? req.user.id : null;
    let userVault = [], premiumGold = 0, cosmetics = { castleId: 'castle_default', skinId: 'skin_default' };

    if (userId) {
      userVault = await req.kv.get(`rol_vault_${userId}`) || [];
      premiumGold = await req.kv.get(`rol_premium_gold_${userId}`) || 0;
      cosmetics = await req.kv.get(`rol_cosmetics_${userId}`) || cosmetics;
    }

    const ownedItems = userVault.map(v => typeof v === 'string' ? v : v.id);
    res.json({
      success: true, premiumGold, store: {
        lastRefresh: Date.now(),
        dailyDeals: [{ id: "skin_raven_lord", name: "Raven Lord Armor", type: "skin", price: 500, currency: "gold", rarity: "legendary" }, { id: "item_relic_forge_hammer", name: "Forge Master's Hammer", type: "item", price: 250, currency: "gold", rarity: "epic" }],
        lootBoxes: 10,
        purchasedSkins: ownedItems.filter(id => id.startsWith('skin_') || id.startsWith('castle_') || id.startsWith('hero_') || id.startsWith('rcastle_')),
        unlockedClasses: ownedItems.filter(id => id.startsWith('class_')), unlockedRaces: ownedItems.filter(id => id.startsWith('race_')),
        purchasedItems: ownedItems, ownedItems, equippedCastle: cosmetics.castleId, equippedHero: cosmetics.skinId
      }
    });
  });

  router.post('/store/equip', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { skinId, category, action } = req.body;
    let cosmetics = await req.kv.get(`rol_cosmetics_${req.user.id}`) || { castleId: 'castle_default', skinId: 'skin_default' };

    if (action === "equip") { if (category === "castle") cosmetics.castleId = skinId; if (category === "hero") cosmetics.skinId = skinId; }
    else if (action === "unequip") { if (category === "castle") cosmetics.castleId = 'castle_default'; if (category === "hero") cosmetics.skinId = 'skin_default'; }

    await req.kv.set(`rol_cosmetics_${req.user.id}`, cosmetics);
    const ownedItems = (await req.kv.get(`rol_vault_${req.user.id}`) || []).map(v => typeof v === 'string' ? v : v.id);
    res.json({ success: true, store: { purchasedItems: ownedItems, ownedItems, equippedCastle: cosmetics.castleId, equippedHero: cosmetics.skinId } });
  });

  const processStoreTransaction = async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const itemId = req.body.itemId || req.body.skinId || req.body.id;
    const cost = parseInt(req.body.price) || parseInt(req.body.cost) || parseInt(req.body.amount) || 0;

    if (!itemId) return res.status(400).json({ error: "Missing item ID" });
    if (cost <= 0) return res.status(400).json({ error: "Store error: Invalid item price! Transaction blocked." });

    let currentGold = await req.kv.get(`rol_premium_gold_${req.user.id}`) || 0;
    if (currentGold < cost) return res.status(400).json({ error: "Not enough Premium Gold!" });

    let userVault = await req.kv.get(`rol_vault_${req.user.id}`) || [];
    if (userVault.some(v => (typeof v === 'string' ? v : v.id) === itemId)) return res.status(400).json({ error: "You already own this item!" });

    currentGold -= cost;
    userVault.push({ id: itemId, acquiredAt: new Date().toISOString() });
    await req.kv.set(`rol_premium_gold_${req.user.id}`, currentGold);
    await req.kv.set(`rol_vault_${req.user.id}`, userVault);

    let cosmetics = await req.kv.get(`rol_cosmetics_${req.user.id}`) || { castleId: 'castle_default', skinId: 'skin_default' };
    const ownedItems = userVault.map(v => typeof v === 'string' ? v : v.id);

    res.json({ success: true, message: "Item purchased successfully!", premiumGold: currentGold, store: { purchasedItems: ownedItems, ownedItems, equippedCastle: cosmetics.castleId, equippedHero: cosmetics.skinId } });
  };

  router.post('/store/buy', processStoreTransaction);
  router.post('/store/purchase', processStoreTransaction);

  router.post('/store/verify-rc-purchase', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { userId, type, goldAmount } = req.body;
    if (req.user.id !== userId) return res.status(403).json({ error: "User ID mismatch" });

    if (type === "gold" && goldAmount) {
      let currentGold = await req.kv.get(`rol_premium_gold_${userId}`) || 0;
      await req.kv.set(`rol_premium_gold_${userId}`, currentGold + goldAmount);
    } else if (type === "vip") {
      let vipData = await req.kv.get(`rol_vip_${userId}`) || { active: true, tier: "Monthly", lootBoxesUsedThisWeek: 0, totalLootBoxesOpened: 0, loyaltyMonths: 0 };
      const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 30);
      vipData.active = true; vipData.expiresAt = expiresAt.toISOString(); vipData.loyaltyMonths += 1;
      await req.kv.set(`rol_vip_${userId}`, vipData);
    }
    res.json({ success: true });
  });

  router.post('/store/open-lootbox', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    let vipData = await req.kv.get(`rol_vip_${req.user.id}`);
    if (!vipData || !vipData.active) return res.status(403).json({ error: "VIP Required to open boxes." });
    if ((vipData.lootBoxesUsedThisWeek || 0) >= 10) return res.status(400).json({ error: "No boxes remaining this week!" });

    vipData.lootBoxesUsedThisWeek += 1; vipData.totalLootBoxesOpened += 1;
    await req.kv.set(`rol_vip_${req.user.id}`, vipData);

    const rarity = rollLootRarity(vipData.loyaltyMonths || 0);
    const possibleItems = LOOT_ITEMS[rarity] || LOOT_ITEMS.common;
    const item = possibleItems[Math.floor(Math.random() * possibleItems.length)];

    let userVault = await req.kv.get(`rol_vault_${req.user.id}`) || [];
    userVault.push({ id: item.id, acquiredAt: new Date().toISOString() });
    await req.kv.set(`rol_vault_${req.user.id}`, userVault);

    res.json({ success: true, loot: { rarity, item } });
  });

  router.get('/store/vault', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    let userVault = await req.kv.get(`rol_vault_${req.user.id}`) || [];
    const allLoot = Object.values(LOOT_ITEMS).flat();

    const populatedVault = userVault.map((savedItem, index) => {
      const rawId = typeof savedItem === 'string' ? savedItem : (savedItem?.id || 'unknown');
      const acquiredAt = typeof savedItem === 'string' ? new Date().toISOString() : (savedItem?.acquiredAt || new Date().toISOString());
      const itemData = allLoot.find(i => i.id === rawId);
      const isCastle = rawId.startsWith('castle_') || rawId.startsWith('rcastle_');
      const isSkin = rawId.startsWith('skin_') || rawId.startsWith('hero_');
      return { ...(itemData || { name: rawId.replace(/r?castle_/, '').replace(/skin_|hero_/, '').replace(/_/g, ' '), emoji: isCastle ? '🏰' : isSkin ? '👕' : '👑', type: isCastle || isSkin ? 'skin' : 'item' }), id: rawId, _uid: `${rawId}-${acquiredAt}-${index}` };
    });
    res.json({ success: true, vault: populatedVault });
  });

  router.post('/store/delete-item', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    let userVault = await req.kv.get(`rol_vault_${req.user.id}`) || [];
    const index = userVault.findIndex(v => (typeof v === 'string' ? v : v.id) === req.body.itemId);
    if (index !== -1) { userVault.splice(index, 1); await req.kv.set(`rol_vault_${req.user.id}`, userVault); }
    res.json({ success: true });
  });

  return router;
};