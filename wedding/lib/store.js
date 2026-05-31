// Upstash Redis storage — reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN from env
const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();

const REG_KEY   = 'wedding:registrations';
const LIKES_KEY = 'wedding:likes';

async function getRegistrations() {
  return (await redis.get(REG_KEY)) || [];
}

async function setRegistrations(list) {
  await redis.set(REG_KEY, list);
}

async function getLikes() {
  const data = await redis.hgetall(LIKES_KEY);
  if (!data) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) out[k] = Number(v) || 0;
  return out;
}

async function incrLike(key, delta) {
  const next = await redis.hincrby(LIKES_KEY, key, delta);
  if (next < 0) { await redis.hset(LIKES_KEY, { [key]: 0 }); return 0; }
  return next;
}

async function deleteLike(key) {
  await redis.hdel(LIKES_KEY, key);
}

module.exports = { redis, getRegistrations, setRegistrations, getLikes, incrLike, deleteLike };
