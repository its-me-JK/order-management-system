import { defineRedisLuaScript, type RedisLuaScript } from '@oms/redis/lua-script';

/** @internal Direct-file source seam for static safety-invariant tests. */
export const REDIS_IDENTITY_SESSION_REFRESH_ABUSE_SCRIPT_SOURCE = String.raw`
local MAX_SAFE_INTEGER = 9007199254740991
local MAX_TIME_SECONDS = 9007199253
local MAX_CAPACITY = 10000
local MAX_INTERVAL_MICROSECONDS = 180000000
local MAX_FULL_REFILL_MICROSECONDS = 3600000000
local MAX_TTL_MILLISECONDS = 3600000

local function fail(message)
  error(message, 0)
end

local function is_canonical_unsigned_decimal(value)
  if type(value) ~= 'string' or value == '' then
    return false
  end

  if value == '0' then
    return true
  end

  return string.match(value, '^[1-9][0-9]*$') ~= nil
end

local function parse_unsigned(value, maximum, failure)
  if not is_canonical_unsigned_decimal(value) then
    fail(failure)
  end

  local parsed = tonumber(value)

  if parsed == nil or parsed < 0 or parsed > maximum or parsed ~= math.floor(parsed) then
    fail(failure)
  end

  return parsed
end

local function parse_policy(capacity_text, interval_text)
  local capacity = parse_unsigned(capacity_text, MAX_CAPACITY, 'OMS_ABUSE_POLICY_INVALID')
  local interval = parse_unsigned(
    interval_text,
    MAX_INTERVAL_MICROSECONDS,
    'OMS_ABUSE_POLICY_INVALID'
  )

  if capacity < 1 or interval < 1000 or capacity * interval > MAX_FULL_REFILL_MICROSECONDS then
    fail('OMS_ABUSE_POLICY_INVALID')
  end

  return {
    capacity = capacity,
    interval = interval,
  }
end

local function parse_time()
  local time = redis.call('TIME')

  if type(time) ~= 'table' or #time ~= 2 then
    fail('OMS_ABUSE_TIME_INVALID')
  end

  local seconds_text = time[1]
  local microseconds_text = time[2]
  local seconds = parse_unsigned(seconds_text, MAX_TIME_SECONDS, 'OMS_ABUSE_TIME_INVALID')
  local microseconds = parse_unsigned(
    microseconds_text,
    999999,
    'OMS_ABUSE_TIME_INVALID'
  )
  local epoch_microseconds = seconds * 1000000 + microseconds

  if epoch_microseconds > MAX_SAFE_INTEGER then
    fail('OMS_ABUSE_TIME_INVALID')
  end

  local epoch_microseconds_text

  if seconds == 0 then
    epoch_microseconds_text = microseconds_text
  else
    epoch_microseconds_text = seconds_text .. string.format('%06d', microseconds)
  end

  return epoch_microseconds, epoch_microseconds_text
end

local function parse_bucket(raw, policy, observed_now, observed_now_text)
  if raw == false then
    return {
      capacity = policy.capacity,
      interval = policy.interval,
      tokens = policy.capacity,
      remainder = 0,
      last = observed_now,
      last_text = observed_now_text,
    }
  end

  if type(raw) ~= 'string' then
    fail('OMS_ABUSE_STATE_INVALID')
  end

  local version, tokens_text, remainder_text, last_text = string.match(
    raw,
    '^(1):([0-9]+):([0-9]+):([0-9]+)$'
  )

  if version ~= '1' then
    fail('OMS_ABUSE_STATE_INVALID')
  end

  local tokens = parse_unsigned(tokens_text, policy.capacity, 'OMS_ABUSE_STATE_INVALID')
  local remainder = parse_unsigned(
    remainder_text,
    policy.interval,
    'OMS_ABUSE_STATE_INVALID'
  )
  local last = parse_unsigned(last_text, MAX_SAFE_INTEGER, 'OMS_ABUSE_STATE_INVALID')

  if tokens >= policy.capacity or remainder >= policy.interval then
    fail('OMS_ABUSE_STATE_INVALID')
  end

  if observed_now < last then
    fail('OMS_ABUSE_TIME_REGRESSION')
  end

  local elapsed = observed_now - last
  local until_full = (policy.capacity - tokens) * policy.interval - remainder

  if until_full < 1 or until_full > MAX_FULL_REFILL_MICROSECONDS then
    fail('OMS_ABUSE_STATE_INVALID')
  end

  if elapsed >= until_full then
    tokens = policy.capacity
    remainder = 0
  else
    local accrued = remainder + elapsed
    local gained = math.floor(accrued / policy.interval)
    tokens = tokens + gained
    remainder = accrued - gained * policy.interval

    if tokens >= policy.capacity or remainder < 0 or remainder >= policy.interval then
      fail('OMS_ABUSE_STATE_INVALID')
    end
  end

  return {
    capacity = policy.capacity,
    interval = policy.interval,
    tokens = tokens,
    remainder = remainder,
    last = observed_now,
    last_text = observed_now_text,
  }
end

local function prepare_write(key, bucket)
  if bucket.tokens == bucket.capacity then
    return {
      key = key,
      operation = 'delete',
    }
  end

  local until_full = (bucket.capacity - bucket.tokens) * bucket.interval - bucket.remainder

  if until_full < 1 or until_full > MAX_FULL_REFILL_MICROSECONDS then
    fail('OMS_ABUSE_STATE_INVALID')
  end

  local ttl_milliseconds = math.floor((until_full + 999) / 1000)

  if ttl_milliseconds < 1 or ttl_milliseconds > MAX_TTL_MILLISECONDS then
    fail('OMS_ABUSE_STATE_INVALID')
  end

  return {
    key = key,
    operation = 'set',
    state = '1:'
      .. tostring(bucket.tokens)
      .. ':'
      .. tostring(bucket.remainder)
      .. ':'
      .. bucket.last_text,
    ttl = tostring(ttl_milliseconds),
  }
end

if #KEYS ~= 4 or #ARGV ~= 7 then
  fail('OMS_ABUSE_INVOCATION_INVALID')
end

if KEYS[1] == KEYS[2]
  or KEYS[1] == KEYS[3]
  or KEYS[1] == KEYS[4]
  or KEYS[2] == KEYS[3]
  or KEYS[2] == KEYS[4]
  or KEYS[3] == KEYS[4]
then
  fail('OMS_ABUSE_INVOCATION_INVALID')
end

local policy_fingerprint = ARGV[1]

if type(policy_fingerprint) ~= 'string'
  or string.match(policy_fingerprint, '^[0-9a-f]+$') == nil
  or string.len(policy_fingerprint) ~= 64
then
  fail('OMS_ABUSE_POLICY_INVALID')
end

local policies = {
  parse_policy(ARGV[2], ARGV[3]),
  parse_policy(ARGV[4], ARGV[5]),
  parse_policy(ARGV[6], ARGV[7]),
}
local marker = redis.call('GET', KEYS[1])

if marker ~= false and marker ~= policy_fingerprint then
  fail('OMS_ABUSE_POLICY_MISMATCH')
end

local raw_buckets = {
  redis.call('GET', KEYS[2]),
  redis.call('GET', KEYS[3]),
  redis.call('GET', KEYS[4]),
}

if marker == false
  and (raw_buckets[1] ~= false or raw_buckets[2] ~= false or raw_buckets[3] ~= false)
then
  fail('OMS_ABUSE_POLICY_MISSING')
end

local observed_now, observed_now_text = parse_time()
local buckets = {}
local denied = false
local retry_after_seconds = 0

for index = 1, 3 do
  local bucket = parse_bucket(raw_buckets[index], policies[index], observed_now, observed_now_text)
  buckets[index] = bucket

  if bucket.tokens < 1 then
    denied = true
    local wait_microseconds = bucket.interval - bucket.remainder
    local wait_seconds = math.floor((wait_microseconds + 999999) / 1000000)

    if wait_seconds < 1 or wait_seconds > 180 then
      fail('OMS_ABUSE_POLICY_INVALID')
    end

    if wait_seconds > retry_after_seconds then
      retry_after_seconds = wait_seconds
    end
  end
end

if not denied then
  for index = 1, 3 do
    buckets[index].tokens = buckets[index].tokens - 1
  end
end

local writes = {
  prepare_write(KEYS[2], buckets[1]),
  prepare_write(KEYS[3], buckets[2]),
  prepare_write(KEYS[4], buckets[3]),
}

redis.call('SET', KEYS[1], 'OMS_ABUSE_POISONED_V1')

for index = 1, 3 do
  local write = writes[index]

  if write.operation == 'delete' then
    redis.call('DEL', write.key)
  else
    redis.call('SET', write.key, write.state, 'PX', write.ttl)
  end
end

redis.call('SET', KEYS[1], policy_fingerprint)

if denied then
  return { 'v1', 'denied', tostring(retry_after_seconds) }
end

return { 'v1', 'allowed', '0' }
`;

/** Static source is captured by the restricted technical executor at module initialization. */
export const REDIS_IDENTITY_SESSION_REFRESH_ABUSE_SCRIPT: RedisLuaScript = defineRedisLuaScript(
  REDIS_IDENTITY_SESSION_REFRESH_ABUSE_SCRIPT_SOURCE,
  4,
  7,
);
