// src/server.js
import bodyParser from "body-parser";
import cors from "cors";
import "dotenv/config";
import express from "express";
import chatRoute from "./routes/chat.js";
import sessionsRouter from "./routes/sessions.js";
import Redis from "ioredis";

const app = express();
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "OPTIONS", "DELETE", "PUT", "PATCH"],
    allowedHeaders: ["Content-Type"],
    preflightContinue: false,
  })
);
app.use(bodyParser.json({ limit: "1mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/chat", chatRoute);
app.use("/sessions", sessionsRouter);

// -------- startup checks ----------
async function runStartupChecks() {
  const out = { redis: { ok: false, msg: null }, prisma: { ok: false, msg: null } };

  // Redis check (robust)
  try {
    const redisUrl = process.env.REDIS_URL || "";
    const r = new Redis(redisUrl, { lazyConnect: true });
    try {
      await r.connect(); // throws on failure
      const pong = await r.ping();
      if (pong && String(pong).toLowerCase().includes("pong")) {
        out.redis.ok = true;
        out.redis.msg = `Connected to Redis at ${redisUrl}`;
      } else {
        out.redis.msg = `Redis ping returned: ${String(pong)}`;
      }
    } catch (connErr) {
      out.redis.ok = false;
      out.redis.msg = `Redis connect/ping failed: ${connErr?.message || connErr}`;
    } finally {
      try { await r.disconnect(); } catch (_) {}
    }
  } catch (e) {
    out.redis.ok = false;
    out.redis.msg = `Redis check error: ${e?.message || e}`;
  }

  // Prisma check (dynamic import)
  try {
    let PrismaClient;
    try {
      const mod = await import("@prisma/client");
      PrismaClient = mod?.PrismaClient;
      if (!PrismaClient) throw new Error("PrismaClient not found in @prisma/client");
    } catch (importErr) {
      out.prisma.ok = false;
      out.prisma.msg = `@prisma/client not ready. Run 'npx prisma generate'. Import error: ${importErr.message || importErr}`;
      return out;
    }

    const prisma = new PrismaClient();
    try {
      await prisma.$connect();
      out.prisma.ok = true;
      out.prisma.msg = "Prisma connected successfully";
    } catch (connErr) {
      out.prisma.ok = false;
      out.prisma.msg = `Prisma connection failed: ${connErr?.message || connErr}`;
    } finally {
      try { await prisma.$disconnect(); } catch (_) {}
    }
  } catch (e) {
    out.prisma.ok = false;
    out.prisma.msg = `Prisma check error: ${e?.message || e}`;
  }

  return out;
}

(async () => {
  const checks = await runStartupChecks();
  console.log("=== startup checks ===");
  console.log("Redis:", checks.redis.ok ? "OK -" : "FAIL -", checks.redis.msg);
  console.log("Prisma:", checks.prisma.ok ? "OK -" : "FAIL -", checks.prisma.msg);
  console.log("======================");

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
})();
