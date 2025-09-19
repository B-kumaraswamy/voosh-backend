// src/routes/sessions.js
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import sessionStore from '../services/sessionStore.js';

const router = express.Router();

/**
 * GET /sessions
 * return list of sessions: [{ id, title, lastTs, msgCount }]
 */
router.get('/', async (req, res) => {
  try {
    const sessions = await sessionStore.listSessions?.() || []; // listSessions should return array
    // Normalize shape
    const payload = sessions.map(s => ({
      id: s.id,
      title: s.title || `Chat ${new Date(s.createdAt || s.ts || Date.now()).toLocaleString()}`,
      createdAt: s.createdAt || s.ts || Date.now(),
      lastAt: s.lastAt || s.updatedAt || null,
      msgCount: (s.msgCount != null ? s.msgCount : (Array.isArray(s.messages) ? s.messages.length : 0)),
    }));
    console.log(`🚀 > payload---->`, payload)
    res.json({ result: payload });
  } catch (err) {
    console.error('GET /sessions err', err);
    res.status(500).json({ error: err.message || 'internal' });
  }
});

/**
 * POST /sessions
 * Create new session, return { id }
 */
router.post('/', async (req, res) => {
  try {
    const id = uuidv4();
    // create session in store
    if (sessionStore.createSession) {
      await sessionStore.createSession({ id, createdAt: Date.now(), title: `Chat ${new Date().toLocaleString()}` });
    } else {
      // fallback: append a metadata message or ensure store initializes session on first append
      await sessionStore.appendMessage(id, { role: 'system', text: 'session-created', ts: Date.now() });
      // remove that system msg if you want; here it's fine.
    }

    res.status(201).json({ id });
  } catch (err) {
    console.error('POST /sessions err', err);
    res.status(500).json({ error: err.message || 'internal' });
  }
});

/**
 * DELETE /sessions/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (sessionStore.deleteSession) {
      await sessionStore.deleteSession(id);
      return res.json({ ok: true });
    }
    // fallback: remove messages for that session if store exposes delete
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /sessions/:id', err);
    res.status(500).json({ error: err.message || 'internal' });
  }
});

/**
 * GET /sessions/:id/messages
 * returns array of messages for session
 */
router.get('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await sessionStore.getMessages(id, 1000) || []; // second arg = limit
    res.json({ messages });
  } catch (err) {
    console.error('GET /sessions/:id/messages', err);
    res.status(500).json({ error: err.message || 'internal' });
  }
});

export default router;
