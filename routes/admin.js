const express = require('express');

module.exports = () => {
  const router = express.Router();

  async function logAdminActivity(req, action, adminEmail, details, targetUserId = null) {
    const log = await req.kv.get('rol_admin_log') || [];
    log.unshift({ id: `log_${Date.now()}`, action, adminEmail, details, targetUserId, timestamp: new Date().toISOString() });
    await req.kv.set('rol_admin_log', log.slice(0, 100));
  }

  router.get('/admin/check', async (req, res) => {
    if (!req.user) return res.json({ authenticated: false });
    const admins = await req.kv.get('rol_admins') || [];
    if (admins.length === 0) return res.json({ authenticated: true, needsSetup: true, isAdmin: false });
    res.json({ authenticated: true, isAdmin: req.isAdmin });
  });

  router.post('/admin/setup', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const admins = await req.kv.get('rol_admins');
    if (admins && admins.length > 0) return res.status(403).json({ error: "Setup already complete." });
    await req.kv.set('rol_admins', [req.user.email]);
    await logAdminActivity(req, "admin_setup", req.user.email, "Initialized dynamic admin system");
    res.json({ success: true });
  });

  router.get('/admin/list-admins', async (req, res) => {
    res.json({ success: true, admins: await req.kv.get('rol_admins') || [] });
  });

  router.post('/admin/add-admin', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    let admins = await req.kv.get('rol_admins') || [];
    if (!admins.includes(req.body.email)) {
      admins.push(req.body.email);
      await req.kv.set('rol_admins', admins);
      await logAdminActivity(req, "add_admin", req.user.email, `Granted admin rights to ${req.body.email}`);
    }
    res.json({ success: true, admins });
  });

  router.post('/admin/remove-admin', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    let admins = await req.kv.get('rol_admins') || [];
    if (admins.length <= 1) return res.status(400).json({ error: "Cannot remove the last admin." });
    if (req.body.email === req.user.email) return res.status(400).json({ error: "Cannot remove yourself." });
    admins = admins.filter(a => a !== req.body.email);
    await req.kv.set('rol_admins', admins);
    await logAdminActivity(req, "remove_admin", req.user.email, `Revoked admin rights from ${req.body.email}`);
    res.json({ success: true, admins });
  });

  router.get('/admin/stats', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    const users = await req.kv.getByPrefix('user_');
    const sessions = await req.kv.getByPrefix("rol_session_idx_");
    res.json({
      success: true,
      stats: { totalUsers: users.length, activeVips: users.filter(u => u.vipActive).length, activeBans: users.filter(u => u.banned).length, totalPurchases: 0, activeSessions: sessions.filter(s => s.status === "lobby" || s.status === "active").length }
    });
  });

  router.get('/admin/users', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    res.json({ success: true, users: await req.kv.getByPrefix('user_') });
  });

  router.get('/admin/activity-log', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    res.json({ success: true, log: await req.kv.get('rol_admin_log') || [] });
  });

  router.get('/admin/reports/players', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    res.json({ success: true, reports: await req.kv.getByPrefix('rol_preport_') });
  });

  router.get('/admin/reports/bugs', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    res.json({ success: true, bugs: await req.kv.getByPrefix('rol_bug_') });
  });

  router.post('/admin/reports/players/status', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    let report = await req.kv.get(`rol_preport_${req.body.reportId}`);
    if (report) { report.status = req.body.status; await req.kv.set(`rol_preport_${req.body.reportId}`, report); }
    res.json({ success: true });
  });

  router.post('/admin/reports/bugs/status', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    let bug = await req.kv.get(`rol_bug_${req.body.bugId}`);
    if (bug) { bug.status = req.body.status; await req.kv.set(`rol_bug_${req.body.bugId}`, bug); }
    res.json({ success: true });
  });

  router.post('/admin/toggle-vip', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    let userRecord = await req.kv.get(req.body.userId);
    if (userRecord) { userRecord.vipActive = req.body.active; await req.kv.set(req.body.userId, userRecord); }
    if (req.body.active) {
      await req.kv.set(`rol_vip_${req.body.userId}`, { active: true, tier: "Grandmaster", lootBoxesUsedThisWeek: 0, totalLootBoxesOpened: 0, loyaltyMonths: 1, grantedAt: new Date().toISOString() });
      await logAdminActivity(req, "grant_vip", req.user.email, `Granted VIP to ${userRecord?.email || req.body.userId}`, req.body.userId);
    } else {
      await req.kv.del(`rol_vip_${req.body.userId}`);
      await logAdminActivity(req, "revoke_vip", req.user.email, `Revoked VIP from ${userRecord?.email || req.body.userId}`, req.body.userId);
    }
    res.json({ success: true });
  });

  router.post('/admin/toggle-ban', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    let userRecord = await req.kv.get(req.body.userId);
    if (userRecord) {
      userRecord.banned = req.body.banned; userRecord.banReason = req.body.reason; await req.kv.set(req.body.userId, userRecord);
      await logAdminActivity(req, req.body.banned ? "ban_user" : "unban_user", req.user.email, `${req.body.banned ? 'Banned' : 'Unbanned'} ${userRecord.email}`, req.body.userId);
    }
    res.json({ success: true });
  });

  router.post('/admin/adjust-gold', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    let currentGold = await req.kv.get(`rol_premium_gold_${req.body.userId}`) || 0;
    currentGold += req.body.amount;
    await req.kv.set(`rol_premium_gold_${req.body.userId}`, currentGold);
    await logAdminActivity(req, req.body.amount > 0 ? "grant_premium" : "remove_premium", req.user.email, `Adjusted Gold for ${req.body.userId}`, req.body.userId);
    res.json({ success: true, premiumGold: currentGold });
  });

  router.get('/admin/gold/:userId', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    res.json({ success: true, goldAdjustment: await req.kv.get(`rol_gold_adj_${req.params.userId}`) || { totalAdjusted: 0, lastClaimedTotal: 0 } });
  });

  router.get('/admin/ban-check/:userId', async (req, res) => {
    const userRecord = await req.kv.get(req.params.userId);
    res.json({ banned: userRecord ? userRecord.banned : false, reason: userRecord ? userRecord.banReason : null });
  });

  // DEV OVERRIDES & ASSETS
  router.post('/store/dev-grant-vip', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    await req.kv.set(`rol_vip_${req.body.userId}`, { active: true, tier: "Dev", lootBoxesUsedThisWeek: 7, totalLootBoxesOpened: 0, loyaltyMonths: 5, grantedAt: new Date().toISOString() });
    await logAdminActivity(req, "grant_vip", req.user.email, `Granted Dev VIP to ${req.body.userId}`, req.body.userId);
    res.json({ success: true });
  });

  router.get('/assets/game-map-urls', async (req, res) => {
    try {
      const urls = {};
      (await req.kv.getByPrefix('rol_asset_')).forEach(a => { if (a.assetKey?.startsWith('map_')) urls[a.assetKey] = a.base64Data; });
      res.json({ success: true, urls });
    } catch (e) { res.status(500).json({ error: "Failed to load maps" }); }
  });

  router.post('/assets/upload', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    await req.kv.set(`rol_asset_${req.body.assetKey}`, { assetKey: req.body.assetKey, base64Data: req.body.base64Data, uploadedAt: new Date().toISOString() });
    res.json({ success: true, url: req.body.base64Data });
  });

  router.post('/assets/upload-bulk', async (req, res) => {
    if (!req.isAdmin) return res.status(403).json({ error: "Forbidden." });
    const results = [];
    for (const asset of req.body.assets) {
      try { await req.kv.set(`rol_asset_${asset.assetKey}`, { ...asset, uploadedAt: new Date().toISOString() }); results.push({ assetKey: asset.assetKey, success: true }); }
      catch (e) { results.push({ assetKey: asset.assetKey, success: false, error: e.message }); }
    }
    res.json({ success: true, results });
  });

  // BUG REPORTS & CUSTOM CONTENT
  router.post('/reports/bugs', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const bugId = `bug_${Date.now()}`;
    await req.kv.set(`rol_bug_${bugId}`, { id: bugId, reporter_id: req.body.reporter_id || req.user.id, reporter_name: req.body.reporter_name || req.user.email.split('@')[0], title: req.body.title, description: req.body.description, severity: req.body.severity, status: 'open', created_at: new Date().toISOString() });
    res.json({ success: true, bugId });
  });

  router.get('/custom-maps/list', (req, res) => res.json({ success: true, maps: [] }));
  router.get('/ai-scripts/list', async (req, res) => res.json({ success: true, scripts: await req.kv.getByPrefix(`rol_ai_${req.query.guestId || "admin"}_`) }));
  router.post('/ai-scripts/save', async (req, res) => { await req.kv.set(`rol_ai_${req.body.guestId || "admin"}_${req.body.script.id}`, req.body.script); res.json({ success: true }); });
  router.delete('/ai-scripts/:id', async (req, res) => { await req.kv.del(`rol_ai_${req.query.guestId || "admin"}_${req.params.id}`); res.json({ success: true }); });
  router.get('/campaigns/list', async (req, res) => res.json({ success: true, campaigns: await req.kv.getByPrefix(`rol_camp_${req.query.userId || req.query.guestId || "anonymous"}_`) }));
  router.post('/campaigns/save', async (req, res) => { await req.kv.set(`rol_camp_${req.body.userId || req.body.guestId || "anonymous"}_${req.body.campaign.id}`, req.body.campaign); res.json({ success: true }); });
  router.delete('/campaigns/:id', async (req, res) => { await req.kv.del(`rol_camp_${req.query.userId || req.query.guestId || "anonymous"}_${req.params.id}`); res.json({ success: true }); });

  return router;
};