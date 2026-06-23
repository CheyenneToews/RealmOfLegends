const express = require('express');

module.exports = () => {
  const router = express.Router();

  // LOBBIES & ENGINE
  router.post('/sessions/create', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const sessionId = `mp_${Date.now()}`;
    const session = {
      id: sessionId, name: req.body.sessionName || `${req.user.email.split("@")[0]}'s Game`, hostId: req.user.id, maxPlayers: req.body.maxPlayers || 4,
      players: [{ userId: req.user.id, email: req.user.email, isHost: true, joinedAt: new Date().toISOString() }],
      status: "lobby", turnCount: 0, initiativeOrder: [], planningIndex: 0, ghostActions: {}, actionLog: [], chatMessages: [], createdAt: new Date().toISOString()
    };
    await req.kv.set(`rol_session_${sessionId}`, session);
    await req.kv.set(`rol_session_idx_${sessionId}`, { id: sessionId, name: session.name, status: "lobby", playerCount: 1, maxPlayers: session.maxPlayers, createdAt: session.createdAt });
    res.json({ success: true, sessionId, session });
  });

  router.get('/sessions', async (req, res) => {
    const sessions = await req.kv.getByPrefix("rol_session_idx_");
    res.json({ success: true, sessions: sessions.filter(s => s.status === "lobby" || s.status === "active") });
  });

  router.get('/sessions/:sessionId', async (req, res) => {
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (!session) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, session });
  });

  router.post('/sessions/:sessionId/join', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (!session) return res.status(404).json({ error: "Not found" });
    if (!session.players.find(p => p.userId === req.user.id)) {
      session.players.push({ userId: req.user.id, email: req.user.email, isHost: false, joinedAt: new Date().toISOString() });
      await req.kv.set(`rol_session_${session.id}`, session);
      let idx = await req.kv.get(`rol_session_idx_${session.id}`);
      if (idx) { idx.playerCount = session.players.length; await req.kv.set(`rol_session_idx_${session.id}`, idx); }
    }
    res.json({ success: true, session });
  });

  router.post('/sessions/:sessionId/start', async (req, res) => {
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (!session) return res.status(404).json({ error: "Not found" });
    session.status = "active"; session.turnCount = 1;
    session.initiativeOrder = session.players.map(p => ({ userId: p.userId, roll: Math.floor(Math.random() * 20) + 1 })).sort((a, b) => a.roll - b.roll);
    session.planningIndex = 0; session.ghostActions = {};
    await req.kv.set(`rol_session_${session.id}`, session);
    await req.kv.set(`rol_session_idx_${session.id}`, { id: session.id, status: "active" });
    res.json({ success: true, session });
  });

  router.post('/sessions/:sessionId/action', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (!session) return res.status(404).json({ error: "Not found" });

    session.actionLog.push({ playerId: req.user.id, action: req.body.action, seq: session.actionLog.length });

    if (req.body.action.type === "END_TURN") {
      if (!session.ghostActions) session.ghostActions = {};

      // THE WEGO FIX: Tell the server to check inside the action payload for the path!
      session.ghostActions[req.user.id] = req.body.ghostPath || req.body.action?.ghostPath || [];

      session.planningIndex = (session.planningIndex || 0) + 1;

      if (req.body.stateSnapshot) {
        if (!session.playerStates) session.playerStates = {};
        session.playerStates[req.user.id] = { snapshot: req.body.stateSnapshot, turnCount: session.turnCount };
      }

      // Turn advances when all players lock in!
      if (session.planningIndex >= session.players.length) {
        session.turnCount += 1;
        session.initiativeOrder = session.players.map(p => ({ userId: p.userId, roll: Math.floor(Math.random() * 20) + 1 })).sort((a, b) => a.roll - b.roll);
        session.planningIndex = 0;
      }
    }

    await req.kv.set(`rol_session_${session.id}`, session);
    res.json({ success: true, session });
  });

  router.get('/sessions/:sessionId/poll', async (req, res) => {
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (!session) return res.status(404).json({ error: "Not found" });
    res.json({
      success: true, actions: session.actionLog.filter(a => a.seq >= parseInt(req.query.since || "0", 10)),
      initiativeOrder: session.initiativeOrder || [], planningIndex: session.planningIndex || 0,
      ghostActions: session.ghostActions || {}, turnCount: session.turnCount, status: session.status,
      players: session.players, playerStates: session.playerStates || {}, chatMessages: session.chatMessages || [],
      competitiveMode: session.competitiveMode || false
    });
  });

  router.post('/sessions/:sessionId/chat', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (session) { session.chatMessages.push({ playerId: req.user.id, playerName: req.user.email.split('@')[0], message: req.body.message, turn: session.turnCount }); await req.kv.set(`rol_session_${session.id}`, session); }
    res.json({ success: true });
  });

  router.put('/sessions/:sessionId/settings', async (req, res) => {
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (session) { session.competitiveMode = !!req.body.competitiveMode; await req.kv.set(`rol_session_${session.id}`, session); res.json({ success: true, competitiveMode: session.competitiveMode }); }
    else res.status(404).json({ error: "Not found" });
  });

  router.post('/sessions/:sessionId/leave', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (session) {
      session.players = session.players.filter(p => p.userId !== req.user.id);
      await req.kv.set(`rol_session_${req.params.sessionId}`, session);
      let idx = await req.kv.get(`rol_session_idx_${req.params.sessionId}`);
      if (idx) { idx.playerCount = session.players.length; await req.kv.set(`rol_session_idx_${req.params.sessionId}`, idx); }
    }
    res.json({ success: true });
  });

  router.post('/sessions/:sessionId/disband', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const session = await req.kv.get(`rol_session_${req.params.sessionId}`);
    if (session && session.hostId === req.user.id) { await req.kv.del(`rol_session_${req.params.sessionId}`); await req.kv.del(`rol_session_idx_${req.params.sessionId}`); }
    res.json({ success: true });
  });

  router.delete('/sessions/:sessionId', async (req, res) => {
    await req.kv.del(`rol_session_${req.params.sessionId}`); await req.kv.del(`rol_session_idx_${req.params.sessionId}`);
    res.json({ success: true });
  });

  // FRIENDS
  router.get('/friends/search', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const query = (req.query.q || "").toLowerCase();
    res.json({ success: true, users: (await req.kv.getByPrefix('user_')).filter(u => u.id !== req.user.id && (u.email.toLowerCase().includes(query) || (u.displayName && u.displayName.toLowerCase().includes(query)))).map(u => ({ id: u.id, display_name: u.displayName })) });
  });

  router.post('/friends/request', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const friendship = { id: `friend_${Date.now()}`, requester_id: req.user.id, receiver_id: req.body.receiverId, status: 'pending', created_at: new Date().toISOString() };
    await req.kv.set(`rol_friendship_${friendship.id}`, friendship);
    res.json({ success: true, friendship });
  });

  router.get('/friends/list', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const myFriendships = (await req.kv.getByPrefix('rol_friendship_')).filter(f => f.requester_id === req.user.id || f.receiver_id === req.user.id);
    for (const f of myFriendships) {
      const friendRecord = await req.kv.get(f.requester_id === req.user.id ? f.receiver_id : f.requester_id);
      if (friendRecord) f.friend_profile = { id: friendRecord.id, display_name: friendRecord.displayName };
    }
    res.json({ success: true, friendships: myFriendships });
  });

  router.post('/friends/accept', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    let friendship = await req.kv.get(`rol_friendship_${req.body.friendshipId}`);
    if (friendship && friendship.receiver_id === req.user.id) { friendship.status = 'accepted'; await req.kv.set(`rol_friendship_${req.body.friendshipId}`, friendship); res.json({ success: true }); }
    else res.status(400).json({ error: "Invalid request" });
  });

  router.delete('/friends/:id', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    await req.kv.del(`rol_friendship_${req.params.id}`); res.json({ success: true });
  });

  router.get('/friends/chat/:friendId', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    res.json({ success: true, messages: await req.kv.get(`rol_chat_${[req.user.id, req.params.friendId].sort().join('_')}`) || [] });
  });

  router.post('/friends/chat', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const convoId = [req.user.id, req.body.receiverId].sort().join('_');
    let chatHistory = await req.kv.get(`rol_chat_${convoId}`) || [];
    const newMessage = { id: `msg_${Date.now()}`, sender_id: req.user.id, receiver_id: req.body.receiverId, content: req.body.content, created_at: new Date().toISOString() };
    chatHistory.push(newMessage);
    await req.kv.set(`rol_chat_${convoId}`, chatHistory);
    res.json({ success: true, message: newMessage });
  });

  // ==========================================
  // CONTINENTAL MESSAGE BOARD
  // ==========================================
  router.get('/board', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const messages = await req.kv.get('rol_message_board') || [];
    res.json({ success: true, messages });
  });

  router.post('/board', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!req.body.content) return res.status(400).json({ error: "Message content required" });

    // Fetch the user to get their actual Display Name, fallback to email prefix if not set
    const userRecord = await req.kv.get(req.user.id);
    const authorName = userRecord?.displayName || req.user.email.split('@')[0];

    let messages = await req.kv.get('rol_message_board') || [];

    const newMessage = {
      id: `mb_${Date.now()}`,
      authorId: req.user.id,
      authorName: authorName,
      content: req.body.content,
      timestamp: new Date().toISOString()
    };

    messages.push(newMessage);

    // GAME INTEGRITY: Keep only the latest 100 messages to prevent database bloat
    if (messages.length > 100) {
      messages = messages.slice(messages.length - 100);
    }

    await req.kv.set('rol_message_board', messages);
    res.json({ success: true, message: newMessage });
  });

  return router;
};