import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.warn('[db] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set. Memory will not work.');
}

const redis = (url && token) ? new Redis({ url, token }) : null;

function keyFor(userId) { return `alice:messages:${userId}`; }

export async function addMessage(userId, role, content) {
  if (!redis) return;
  const k = keyFor(userId);
  await redis.lpush(k, JSON.stringify({ role, content, ts: Date.now() }));
  await redis.ltrim(k, 0, 499);
  await redis.expire(k, 60 * 60 * 24 * 30);
}

export async function getRecentMessages(userId, limit = 12) {
  if (!redis) return [];
  const k = keyFor(userId);
  const raw = await redis.lrange(k, 0, limit - 1);
  const arr = raw.map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  return arr.reverse();
}

export async function clearUser(userId) {
  if (!redis) return;
  const k = keyFor(userId);
  await redis.del(k);
}
