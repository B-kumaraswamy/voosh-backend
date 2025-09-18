// src/services/sessionStore.js
// Session store using Redis (hot cache) + Postgres via Prisma (durable).
// Works with Prisma schema that has Session and Transcript models (Transcript.content).
//
// Behavior:
// - Reads attempt Redis first; on miss, read Postgres and populate Redis.
// - Writes persist to Postgres (if available) and push to Redis list.
// - TTL for Redis keys is configurable (default 24h).
// - Console logs indicate which backend served the request.

import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";

const REDIS_URL = process.env.REDIS_URL || "";
const TTL = parseInt(process.env.SESSION_TTL_SECONDS || "86400", 10); // seconds
const MAX_MESSAGES_REDIS = parseInt(
  process.env.MAX_MESSAGES_REDIS || "500",
  10
);

const SESSIONS_ZSET = "sessions:list";
const messagesKey = (sessionId) => `session:messages:${sessionId}`;
const metaKey = (sessionId) => `session:meta:${sessionId}`;

let redis = null;
if (REDIS_URL) {
  try {
    redis = new Redis(REDIS_URL);
    redis.on("error", (e) => {
      console.warn(
        "[sessionStore] Redis error:",
        e && e.message ? e.message : e
      );
    });
  } catch (e) {
    console.warn(
      "[sessionStore] Failed to create Redis client:",
      e && e.message ? e.message : e
    );
    redis = null;
  }
}

// Lazy Prisma init. Prisma is optional — service still works with Redis-only.
let prisma = null;
async function tryInitPrisma() {
  if (prisma) return;
  try {
    const mod = await import("@prisma/client");
    prisma = new mod.PrismaClient();
    console.log("[sessionStore] Prisma initialized.");
  } catch (e) {
    prisma = null;
    console.warn(
      "[sessionStore] Prisma not available or not configured. Running in cache-only mode."
    );
  }
}

// Utility: normalize createSession args
function normalizeCreateArgs(arg1, arg2) {
  if (typeof arg1 === "object" && arg1 !== null && !arg2)
    return { id: null, opts: arg1 };
  if (typeof arg1 === "string") return { id: arg1, opts: arg2 || {} };
  return { id: null, opts: arg2 || {} };
}

const store = {
  // initialize (optional)
  async init() {
    await tryInitPrisma();
  },

  /**
   * createSession(arg?, opts?)
   * Returns created session id (string).
   * Schema: Session { id, createdAt } ; transcripts relation exists but no title/updatedAt columns.
   */
  async createSession(arg1 = null, arg2 = {}) {
    const { id, opts } = normalizeCreateArgs(arg1, arg2);
    const sid = id || uuidv4();
    const createdAt = opts.createdAt ? new Date(opts.createdAt) : new Date();

    // Try to write session row to DB (if Prisma available)
    await tryInitPrisma();
    if (prisma) {
      try {
        // Upsert: create if missing; update does nothing (schema has no updatedAt field)
        await prisma.session.upsert({
          where: { id: sid },
          update: {},
          create: {
            id: sid,
            createdAt,
          },
        });

        // populate redis meta if possible
        if (redis) {
          await redis.hset(metaKey(sid), {
            id: sid,
            // title not present in schema — keep empty
            title: "",
            createdAt: createdAt.toISOString(),
            updatedAt: createdAt.toISOString(),
            msgCount: 0,
          });
          await redis.expire(metaKey(sid), TTL);
          await redis.zadd(SESSIONS_ZSET, Date.now(), sid);
          await redis.expire(SESSIONS_ZSET, TTL);
        }

        console.log(
          `[sessionStore] createSession: created session ${sid} persisted in Postgres.`
        );
        return sid;
      } catch (e) {
        console.warn(
          "[sessionStore] createSession: prisma upsert failed, falling back to cache-only:",
          e && e.message ? e.message : e
        );
      }
    }

    // Redis-only path
    if (redis) {
      try {
        await redis.hset(metaKey(sid), {
          id: sid,
          title: "",
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          msgCount: 0,
        });
        await redis.expire(metaKey(sid), TTL);
        await redis.zadd(SESSIONS_ZSET, Date.now(), sid);
        await redis.expire(SESSIONS_ZSET, TTL);
        console.log(
          `[sessionStore] createSession: created session ${sid} in Redis (cache-only).`
        );
        return sid;
      } catch (e) {
        console.warn(
          "[sessionStore] createSession: redis write failed:",
          e && e.message ? e.message : e
        );
      }
    }

    // If no storage available, return id (volatile)
    console.log(
      `[sessionStore] createSession: returning volatile session ${sid} (no storage available).`
    );
    return sid;
  },

  /**
   * appendMessage(sessionId, message)
   * message: { role, text, ts? }
   */
  async appendMessage(sessionId, message) {
    const msg = {
      id: message.id || uuidv4(),
      role: message.role || "user",
      text: String(message.text || ""),
      ts: message.ts
        ? new Date(message.ts).toISOString()
        : new Date().toISOString(),
    };

    // Persist to DB first (best-effort) using Transcript model
    await tryInitPrisma();
    if (prisma) {
      try {
        await prisma.transcript.create({
          data: {
            id: msg.id,
            sessionId,
            role: msg.role,
            content: msg.text,
            createdAt: new Date(msg.ts),
          },
        });
        // no session.updatedAt field in schema, so skip updating session row
      } catch (e) {
        console.warn(
          "[sessionStore] appendMessage: prisma write failed (continuing):",
          e && e.message ? e.message : e
        );
      }
    }

    // Push to Redis (tail = chronological)
    if (redis) {
      try {
        const key = messagesKey(sessionId);
        const payload = JSON.stringify(msg);
        await redis.rpush(key, payload);
        // keep list trimmed to last MAX_MESSAGES_REDIS elements
        await redis.ltrim(key, -MAX_MESSAGES_REDIS, -1);
        await redis.expire(key, TTL);

        // update meta
        const mkey = metaKey(sessionId);
        await redis.hincrby(mkey, "msgCount", 1);
        await redis.hset(mkey, "updatedAt", new Date().toISOString());
        await redis.expire(mkey, TTL);

        // update sessions set
        await redis.zadd(SESSIONS_ZSET, Date.now(), sessionId);
        await redis.expire(SESSIONS_ZSET, TTL);

        console.log(
          `[sessionStore] appendMessage: pushed to Redis for session ${sessionId}`
        );
        return { sessionId, message: msg };
      } catch (e) {
        console.warn(
          "[sessionStore] appendMessage: redis write failed (continuing):",
          e && e.message ? e.message : e
        );
      }
    }

    // If Redis not available, we still return the message (DB may have persisted)
    console.log(
      `[sessionStore] appendMessage: stored message for ${sessionId} (redis unavailable)`
    );
    return { sessionId, message: msg };
  },

  /**
   * getMessages(sessionId, limit)
   * Try Redis first; fallback to Postgres if available.
   * returns array of messages (chronological)
   */
  async getMessages(sessionId, limit = 1000) {
    // try redis
    if (redis) {
      try {
        const exists = await redis.exists(messagesKey(sessionId));
        if (exists) {
          let items = await redis.lrange(messagesKey(sessionId), 0, -1);
          if (limit && items.length > limit) items = items.slice(-limit);
          const parsed = items.map((s) => JSON.parse(s));
          // refresh TTLs and zset score
          await redis.expire(messagesKey(sessionId), TTL);
          await redis.expire(metaKey(sessionId), TTL);
          await redis.zadd(SESSIONS_ZSET, Date.now(), sessionId);
          await redis.expire(SESSIONS_ZSET, TTL);
          console.log(
            `[sessionStore] getMessages: HIT Redis for ${sessionId} (returned ${parsed.length})`
          );
          return parsed;
        }
      } catch (e) {
        console.warn(
          "[sessionStore] getMessages: redis error (falling back):",
          e && e.message ? e.message : e
        );
      }
    }

    // fallback to DB (Transcripts)
    await tryInitPrisma();
    if (prisma) {
      try {
        const rows = await prisma.transcript.findMany({
          where: { sessionId },
          orderBy: { createdAt: "asc" },
        });
        const docs = rows.map((r) => ({
          id: r.id,
          role: r.role,
          text: r.content,
          ts: r.createdAt.toISOString(),
        }));

        // populate redis for future reads
        if (redis && docs.length) {
          try {
            await redis.del(messagesKey(sessionId));
            const serialized = docs.map((d) => JSON.stringify(d));
            if (serialized.length)
              await redis.rpush(messagesKey(sessionId), ...serialized);
            await redis.expire(messagesKey(sessionId), TTL);
            // set meta
            await redis.hset(metaKey(sessionId), {
              id: sessionId,
              title: "",
              msgCount: String(docs.length),
              createdAt: docs[0]?.ts || new Date().toISOString(),
              updatedAt: docs[docs.length - 1]?.ts || new Date().toISOString(),
            });
            await redis.expire(metaKey(sessionId), TTL);
            await redis.zadd(SESSIONS_ZSET, Date.now(), sessionId);
            await redis.expire(SESSIONS_ZSET, TTL);
          } catch (_) {
            // ignore population errors
          }
        }

        console.log(
          `[sessionStore] getMessages: Served from Postgres for ${sessionId} (returned ${docs.length})`
        );
        if (limit && docs.length > limit) return docs.slice(-limit);
        return docs;
      } catch (e) {
        console.warn(
          "[sessionStore] getMessages: prisma read failed:",
          e && e.message ? e.message : e
        );
      }
    }

    // If neither redis nor prisma available, return empty
    console.log(
      `[sessionStore] getMessages: no backend available for ${sessionId} — returning []`
    );
    return [];
  },

  /**
   * listSessions(limit)
   * Try Redis zset+hashes first; fallback to Postgres.
   */
  async listSessions(limit = 200) {
    if (redis) {
      try {
        const ids = await redis.zrevrange(SESSIONS_ZSET, 0, limit - 1);
        if (ids && ids.length) {
          const pipe = redis.pipeline();
          ids.forEach((id) => pipe.hgetall(metaKey(id)));
          const results = (await pipe.exec()).map((r) => r[1] || {});
          const metas = results.map((m) => ({
            id: m.id,
            title: m.title || null,
            createdAt: m.createdAt || null,
            updatedAt: m.updatedAt || null,
            msgCount: parseInt(m.msgCount || "0", 10),
          }));
          console.log(
            `[sessionStore] listSessions: HIT Redis (returned ${metas.length})`
          );
          return metas;
        }
      } catch (e) {
        console.warn(
          "[sessionStore] listSessions: redis error (falling back):",
          e && e.message ? e.message : e
        );
      }
    }

    // fallback to DB
    await tryInitPrisma();
    if (prisma) {
      try {
        const sessions = await prisma.session.findMany({
          orderBy: { createdAt: "desc" }, // no updatedAt field in schema
          take: limit,
          include: { _count: { select: { transcripts: true } } },
        });

        // populate redis meta (best effort)
        if (redis && Array.isArray(sessions)) {
          try {
            const pipe = redis.pipeline();
            sessions.forEach((s) => {
              pipe.hset(metaKey(s.id), {
                id: s.id,
                title: "",
                msgCount: String(s._count?.transcripts || 0),
                createdAt: s.createdAt?.toISOString?.() || "",
                updatedAt: s.createdAt?.toISOString?.() || "",
              });
              pipe.expire(metaKey(s.id), TTL);
              pipe.zadd(
                SESSIONS_ZSET,
                new Date(s.createdAt).getTime() || Date.now(),
                s.id
              );
            });
            pipe.expire(SESSIONS_ZSET, TTL);
            await pipe.exec();
          } catch (_) {}
        }

        const out = sessions.map((s) => ({
          id: s.id,
          title: s.title || null, // schema doesn't have title; will be undefined -> null
          createdAt: s.createdAt,
          updatedAt: s.createdAt,
          msgCount: s._count?.transcripts || 0,
        }));
        console.log(
          `[sessionStore] listSessions: Served from Postgres (returned ${out.length})`
        );
        return out;
      } catch (e) {
        console.warn(
          "[sessionStore] listSessions: prisma read failed:",
          e && e.message ? e.message : e
        );
      }
    }

    console.log(
      "[sessionStore] listSessions: no backend available — returning []"
    );
    return [];
  },

  /**
   * deleteSession(sessionId)
   * Remove from Postgres and Redis
   */
  async deleteSession(sessionId) {
    await tryInitPrisma();
    if (prisma) {
      try {
        await prisma.$transaction([
          prisma.transcript.deleteMany({ where: { sessionId } }),
          prisma.session.delete({ where: { id: sessionId } }),
        ]);
        console.log(
          `[sessionStore] deleteSession: removed ${sessionId} from Postgres`
        );
      } catch (e) {
        console.warn(
          "[sessionStore] deleteSession: prisma delete failed (continuing):",
          e && e.message ? e.message : e
        );
      }
    }

    if (redis) {
      try {
        await redis.del(messagesKey(sessionId));
        await redis.del(metaKey(sessionId));
        await redis.zrem(SESSIONS_ZSET, sessionId);
        console.log(
          `[sessionStore] deleteSession: removed ${sessionId} from Redis`
        );
      } catch (e) {
        console.warn(
          "[sessionStore] deleteSession: redis delete failed:",
          e && e.message ? e.message : e
        );
      }
    }

    return { ok: true, id: sessionId };
  },

  /**
   * getSessionMeta(sessionId)
   * lightweight meta from redis or DB
   */
  async getSessionMeta(sessionId) {
    if (redis) {
      try {
        const m = await redis.hgetall(metaKey(sessionId));
        if (m && Object.keys(m).length) {
          await redis.expire(metaKey(sessionId), TTL);
          await redis.zadd(SESSIONS_ZSET, Date.now(), sessionId);
          await redis.expire(SESSIONS_ZSET, TTL);
          return {
            id: m.id,
            title: m.title || null,
            msgCount: parseInt(m.msgCount || "0", 10),
            createdAt: m.createdAt || null,
            updatedAt: m.updatedAt || null,
          };
        }
      } catch (e) {
        console.warn(
          "[sessionStore] getSessionMeta: redis error (falling back):",
          e && e.message ? e.message : e
        );
      }
    }

    await tryInitPrisma();
    if (prisma) {
      try {
        const s = await prisma.session.findUnique({
          where: { id: sessionId },
          include: { _count: { select: { transcripts: true } } },
        });
        if (!s) return null;
        if (redis) {
          try {
            await redis.hset(metaKey(sessionId), {
              id: s.id,
              title: "",
              msgCount: String(s._count?.transcripts || 0),
              createdAt: s.createdAt?.toISOString?.() || "",
              updatedAt: s.createdAt?.toISOString?.() || "",
            });
            await redis.expire(metaKey(sessionId), TTL);
            await redis.zadd(
              SESSIONS_ZSET,
              new Date(s.createdAt).getTime() || Date.now(),
              s.id
            );
            await redis.expire(SESSIONS_ZSET, TTL);
          } catch (_) {}
        }
        return {
          id: s.id,
          title: s.title || null,
          msgCount: s._count?.transcripts || 0,
          createdAt: s.createdAt,
          updatedAt: s.createdAt,
        };
      } catch (e) {
        console.warn(
          "[sessionStore] getSessionMeta: prisma read failed:",
          e && e.message ? e.message : e
        );
      }
    }

    return null;
  },
};

export default store;
