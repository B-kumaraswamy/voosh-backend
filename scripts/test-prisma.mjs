// scripts/test-prisma.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error']
});

async function main() {
  try {
    console.log('DATABASE_URL:', process.env.DATABASE_URL ? '[FOUND]' : '[MISSING]');
    await prisma.$connect();
    console.log('✅ Prisma: CONNECTED');
    // run a lightweight query to ensure schema exists and tables accessible
    try {
      const count = await prisma.$queryRaw`SELECT 1 as ok`;
      console.log('✅ Prisma: basic query OK');
    } catch (e) {
      console.warn('⚠️ Prisma: basic query failed (schema/tables might be missing)', e.message || e);
    }
  } catch (err) {
    console.error('❌ Prisma connect error:', err.message || err);
    process.exitCode = 2;
  } finally {
    try {
      await prisma.$disconnect();
      console.log('Prisma: disconnected');
    } catch {}
  }
}

main();
