const express = require('express');
const crypto = require('crypto');

module.exports = (transporter) => {
  const router = express.Router();

  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  function verifyPassword(password, storedHash) {
    if (!storedHash) return true;
    const [salt, key] = storedHash.split(':');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return key === hash;
  }

  async function trackUser(req, email, displayName = null, password = null) {
    const userId = `user_${email}`;
    let userRecord = await req.kv.get(userId);

    let admins = await req.kv.get('rol_admins') || ["cheyennetoews@gmail.com", "primedchronicoms@gmail.com"];
    const isGameMaster = admins.includes(email);

    if (!userRecord) {
      userRecord = {
        id: userId, email: email, displayName: displayName || email.split('@')[0],
        passwordHash: password ? hashPassword(password) : null,
        createdAt: new Date().toISOString(), lastSignIn: new Date().toISOString(),
        emailConfirmed: true, vipActive: isGameMaster, vipExpiresAt: null,
        totalLootBoxes: isGameMaster ? 99 : 0, banned: false, banReason: null, purchasedSkins: 0
      };
      console.log(`[DATABASE] New account registered: ${email}`);

      if (isGameMaster) {
        await req.kv.set(`rol_vip_${userId}`, {
          active: true, tier: "Grandmaster", lootBoxesUsedThisWeek: 0,
          totalLootBoxesOpened: 0, loyaltyMonths: 12, grantedAt: new Date().toISOString()
        });
      }
    } else {
      userRecord.lastSignIn = new Date().toISOString();
      if (password && !userRecord.passwordHash) {
        userRecord.passwordHash = hashPassword(password);
      }
    }
    await req.kv.set(userId, userRecord);
    return userRecord;
  }

  router.post('/auth/v1/signup', async (req, res) => {
    const email = req.body?.email;
    const password = req.body?.password;
    const name = req.body?.name || email.split('@')[0];

    if (!email || !password) return res.status(400).json({ error: "Email and password required." });

    const existingUser = await req.kv.get(`user_${email}`);
    if (existingUser) return res.status(400).json({ error: "Account already exists." });

    await trackUser(req, email, name, password);
    const token = Buffer.from(email).toString('base64');

    res.json({
      access_token: token, token_type: "bearer", expires_in: 360000, refresh_token: token,
      user: { id: `user_${email}`, aud: "authenticated", role: "authenticated", email: email }
    });
  });

  router.post('/auth/v1/token', async (req, res) => {
    const email = req.body?.email;
    const password = req.body?.password;

    if (!email || !password) return res.status(400).json({ error: "Email and password required." });

    let userRecord = await req.kv.get(`user_${email}`);
    if (!userRecord || !verifyPassword(password, userRecord.passwordHash)) {
      return res.status(400).json({ error: "Invalid credentials." });
    }

    await trackUser(req, email, null, password);
    const token = Buffer.from(email).toString('base64');
    res.json({
      access_token: token, token_type: "bearer", expires_in: 360000, refresh_token: token,
      user: { id: `user_${email}`, aud: "authenticated", role: "authenticated", email: email }
    });
  });

  router.get('/auth/v1/user', (req, res) => {
    if (!req.user) return res.json({ id: `user_local@player.com`, aud: "authenticated", role: "authenticated", email: "local@player.com" });
    res.json({ id: req.user.id, aud: "authenticated", role: "authenticated", email: req.user.email });
  });

  router.post('/auth/v1/recover', async (req, res) => {
    const email = req.body?.email;
    if (!email) return res.status(400).json({ error: "Email required." });

    const userRecord = await req.kv.get(`user_${email}`);
    if (!userRecord) return res.json({ success: true, message: "If an account exists, a reset link was sent." });

    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    await req.kv.set(`reset_pin_${email}`, { pin, expires: Date.now() + 15 * 60 * 1000 });

    const mailOptions = {
      from: '"Realm of Legends Support" <primedchronicoms@gmail.com>',
      to: email,
      subject: 'Password Reset PIN',
      text: `Your password reset PIN is: ${pin}\n\nThis PIN will expire in 15 minutes.`,
      html: `<h3>Realm of Legends Password Reset</h3><p>Your password reset PIN is: <strong style="font-size: 24px;">${pin}</strong></p><p>This PIN will expire in 15 minutes.</p>`
    };

    try {
      await transporter.sendMail(mailOptions);
      res.json({ success: true, message: "Reset email sent." });
    } catch (error) {
      res.status(500).json({ error: "Failed to send email." });
    }
  });

  router.post('/auth/v1/update', async (req, res) => {
    const { email, pin, newPassword } = req.body;
    if (!email || !pin || !newPassword) return res.status(400).json({ error: "Email, PIN, and new password required." });

    const resetData = await req.kv.get(`reset_pin_${email}`);
    if (!resetData || resetData.pin !== pin || Date.now() > resetData.expires) {
      return res.status(400).json({ error: "Invalid or expired PIN." });
    }

    let userRecord = await req.kv.get(`user_${email}`);
    if (userRecord) {
      userRecord.passwordHash = hashPassword(newPassword);
      await req.kv.set(`user_${email}`, userRecord);
      await req.kv.del(`reset_pin_${email}`);
      res.json({ success: true, message: "Password updated successfully." });
    } else {
      res.status(400).json({ error: "Account not found." });
    }
  });

  // GAME SAVES
  router.post('/save-game', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { saveId, saveData } = req.body;
    if (!saveId || !saveData) return res.status(400).json({ error: "Missing data" });

    const namespacedId = `${req.user.id}_${saveId}`;
    await req.kv.set(`rol_save_${namespacedId}`, saveData);
    await req.kv.set(`rol_save_index_${namespacedId}`, {
      saveId, ownerId: req.user.id, characterName: saveData.character?.name || "Unknown",
      level: saveData.character?.level || 1, turnCount: saveData.turnCount || 1, savedAt: new Date().toISOString(),
    });
    res.json({ success: true, saveId });
  });

  router.get('/list-saves', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const allSaves = await req.kv.getByPrefix('rol_save_index_');
    res.json({ success: true, saves: allSaves.filter(s => s.ownerId === req.user.id) });
  });

  router.get('/load-game/:saveId', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const saveData = await req.kv.get(`rol_save_${req.user.id}_${req.params.saveId}`);
    if (!saveData) return res.status(404).json({ error: "Save not found" });
    res.json({ success: true, saveData });
  });

  router.delete('/delete-save/:saveId', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    await req.kv.del(`rol_save_${req.user.id}_${req.params.saveId}`);
    await req.kv.del(`rol_save_index_${req.user.id}_${req.params.saveId}`);
    res.json({ success: true });
  });

  // PRESETS
  router.get('/presets/list', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const presets = await req.kv.get(`rol_presets_${req.user.id}`) || [null, null];
    res.json({ success: true, presets });
  });

  router.post('/presets/save', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { presetName, characterData, slotIndex } = req.body;
    if (slotIndex !== 0 && slotIndex !== 1) return res.status(400).json({ error: "Invalid preset slot." });

    let isVip = false;
    const vipData = await req.kv.get(`rol_vip_${req.user.id}`);
    if (vipData && vipData.active) isVip = true;

    if (slotIndex === 1 && !isVip) return res.status(403).json({ error: "Slot 2 is reserved for VIP Grandmasters." });

    let presets = await req.kv.get(`rol_presets_${req.user.id}`) || [null, null];
    if (presets.length < 2) presets = [presets[0] || null, null];
    presets[slotIndex] = { name: presetName || "Quick Start", character: characterData, savedAt: new Date().toISOString() };

    await req.kv.set(`rol_presets_${req.user.id}`, presets);
    res.json({ success: true, presets });
  });

  return router;
};