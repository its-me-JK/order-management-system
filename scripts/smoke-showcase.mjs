#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const TERMINAL_PAYMENT_STATUSES = new Set(['AUTHORIZED', 'FAILED']);

class SmokeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SmokeError';
  }
}

function integerSetting(name, fallback, minimum, maximum) {
  const candidate = process.env[name] ?? String(fallback);

  if (!/^\d+$/u.test(candidate)) {
    throw new SmokeError(`Invalid ${name} setting`);
  }

  const value = Number(candidate);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SmokeError(`Invalid ${name} setting`);
  }

  return value;
}

function configuredBaseUrl() {
  try {
    const url = new URL(process.env['OMS_BASE_URL'] ?? DEFAULT_BASE_URL);

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new Error();
    }

    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`;
    return url;
  } catch {
    throw new SmokeError('Invalid OMS_BASE_URL setting');
  }
}

const BASE_URL = configuredBaseUrl();
const REQUEST_TIMEOUT_MS = integerSetting('OMS_SMOKE_REQUEST_TIMEOUT_MS', 10_000, 1_000, 60_000);
const ASYNC_TIMEOUT_MS = integerSetting('OMS_SMOKE_ASYNC_TIMEOUT_MS', 60_000, 5_000, 300_000);
const POLL_INTERVAL_MS = integerSetting('OMS_SMOKE_POLL_INTERVAL_MS', 500, 100, 5_000);
const MAX_ORDER_ATTEMPTS = integerSetting('OMS_SMOKE_MAX_ORDER_ATTEMPTS', 5, 2, 10);

class CookieJar {
  #cookies = new Map();

  capture(headers) {
    const getter = headers.getSetCookie;
    const fallback = headers.get('set-cookie');
    const values =
      typeof getter === 'function' ? getter.call(headers) : fallback === null ? [] : [fallback];

    for (const value of values) {
      const pair = value.split(';', 1)[0] ?? '';
      const separator = pair.indexOf('=');

      if (separator <= 0) continue;

      const name = pair.slice(0, separator).trim();
      const cookieValue = pair.slice(separator + 1).trim();
      const expired = /(?:^|;)\s*Max-Age=0(?:;|$)/iu.test(value);

      if (cookieValue === '' || expired) {
        this.#cookies.delete(name);
      } else {
        this.#cookies.set(name, cookieValue);
      }
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  has(name) {
    return this.#cookies.has(name);
  }
}

function assert(condition, message) {
  if (!condition) throw new SmokeError(message);
}

function record(value, label) {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label} is invalid`,
  );
  return value;
}

function array(value, label) {
  assert(Array.isArray(value), `${label} is invalid`);
  return value;
}

function string(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} is invalid`);
  return value;
}

function bearerHeaders(session) {
  return { Authorization: `Bearer ${session.accessToken}` };
}

async function request(path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  const cookie = options.jar?.header();

  if (cookie !== undefined && cookie !== '') headers.set('Cookie', cookie);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  let response;

  try {
    response = await fetch(new URL(path.replace(/^\//u, ''), BASE_URL), {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SmokeError(`Request failed: ${method} ${path}`);
  }

  options.jar?.capture(response.headers);
  const expectedStatuses = options.expectedStatuses ?? [200];

  if (!expectedStatuses.includes(response.status)) {
    await response.body?.cancel();
    throw new SmokeError(`Unexpected HTTP ${String(response.status)}: ${method} ${path}`);
  }

  if (options.text === true) {
    return { headers: response.headers, value: await response.text() };
  }

  if (response.status === 204) return { headers: response.headers, value: null };

  try {
    return { headers: response.headers, value: await response.json() };
  } catch {
    throw new SmokeError(`Invalid JSON response: ${method} ${path}`);
  }
}

async function poll(label, operation, predicate) {
  const deadline = Date.now() + ASYNC_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const value = await operation();

    if (predicate(value)) return value;
    await wait(POLL_INTERVAL_MS);
  }

  throw new SmokeError(`Timed out waiting for ${label}`);
}

async function verifyHealthAndHomepage() {
  for (const path of ['/health/live', '/health/ready']) {
    const payload = record((await request(path)).value, `${path} response`);
    assert(payload.status === 'ok', `${path} is not healthy`);
  }

  const homepage = await request('/', { text: true });
  const contentType = homepage.headers.get('content-type') ?? '';

  assert(contentType.toLowerCase().includes('text/html'), 'Homepage is not HTML');
  assert(/<html(?:\s|>)/iu.test(homepage.value), 'Homepage document is invalid');
  assert(homepage.value.includes('Orderly'), 'Homepage showcase content is missing');
  console.log('[smoke] Health dependencies and static homepage verified');
}

async function login(label, email, password, expectedRole) {
  const jar = new CookieJar();
  const payload = record(
    (await request('/api/v1/auth/login', { body: { email, password }, jar, method: 'POST' })).value,
    `${label} login response`,
  );
  const accessToken = string(payload.accessToken, `${label} access token`);
  const csrfToken = string(payload.csrfToken, `${label} CSRF token`);
  const user = record(payload.user, `${label} user`);

  assert(/^[A-Za-z0-9_-]{43}$/u.test(accessToken), `${label} access token format is invalid`);
  assert(/^[A-Za-z0-9_-]{43}$/u.test(csrfToken), `${label} CSRF token format is invalid`);
  assert(payload.tokenType === 'Bearer', `${label} token type is invalid`);
  assert(user.role === expectedRole, `${label} role is invalid`);
  assert(jar.has('oms_refresh'), `${label} refresh cookie is missing`);

  const session = { accessToken, csrfToken, jar, loggedOut: false };
  const currentUser = record(
    (await request('/api/v1/auth/me', { headers: bearerHeaders(session) })).value,
    `${label} current user`,
  );

  assert(
    currentUser.id === user.id && currentUser.role === expectedRole,
    `${label} session is invalid`,
  );
  console.log(`[smoke] ${label} authentication verified`);
  return session;
}

async function logout(session, label) {
  if (session === undefined || session.loggedOut) return;

  await request('/api/v1/auth/logout', {
    expectedStatuses: [204],
    headers: { 'X-CSRF-Token': session.csrfToken },
    jar: session.jar,
    method: 'POST',
  });
  assert(!session.jar.has('oms_refresh'), `${label} refresh cookie was not cleared`);
  session.loggedOut = true;
  console.log(`[smoke] ${label} logout verified`);
}

async function catalogSku() {
  const payload = record(
    (await request('/api/v1/catalog/skus?limit=100')).value,
    'Catalog response',
  );
  const skus = array(payload.data, 'Catalog items');
  const sku = skus
    .map((candidate) => record(candidate, 'Catalog SKU'))
    .filter((candidate) => Number.isInteger(candidate.available) && candidate.available > 0)
    .sort((left, right) => right.available - left.available)[0];

  assert(sku !== undefined, 'Catalog has no available SKU');
  string(sku.id, 'Catalog SKU id');
  string(sku.code, 'Catalog SKU code');
  string(sku.price, 'Catalog SKU price');
  console.log('[smoke] Public catalog verified');
  return sku;
}

function orderData(payload, label) {
  const envelope = record(payload, `${label} response`);
  const order = record(envelope.data, label);

  string(order.id, `${label} id`);
  string(order.orderNumber, `${label} number`);
  string(order.status, `${label} status`);
  array(order.items, `${label} items`);
  return order;
}

async function createAuthorizedOrder(customer, sku) {
  const body = {
    items: [{ quantity: 1, skuId: sku.id }],
    shippingAddress: {
      city: 'Bengaluru',
      country: 'IN',
      line1: '42 Residency Road',
      postalCode: '560025',
      state: 'Karnataka',
    },
  };

  for (let attempt = 1; attempt <= MAX_ORDER_ATTEMPTS; attempt += 1) {
    const idempotencyKey = `smoke-${Date.now()}-${attempt}-${randomUUID()}`;
    const createOptions = {
      body,
      expectedStatuses: [200, 201],
      headers: { ...bearerHeaders(customer), 'Idempotency-Key': idempotencyKey },
      method: 'POST',
    };
    const created = orderData(
      (await request('/api/v1/orders', createOptions)).value,
      'Created order',
    );
    const replayed = orderData(
      (await request('/api/v1/orders', createOptions)).value,
      'Replayed order',
    );

    assert(created.id === replayed.id, 'Idempotency replay created a different order');
    assert(created.orderNumber === replayed.orderNumber, 'Idempotency replay changed the order');

    await request('/api/v1/orders', {
      ...createOptions,
      body: { ...body, items: [{ quantity: 2, skuId: sku.id }] },
      expectedStatuses: [409],
    });

    const payment = await poll(
      'payment resolution',
      async () => {
        const envelope = record(
          (
            await request(`/api/v1/orders/${encodeURIComponent(created.id)}/payment`, {
              headers: bearerHeaders(customer),
            })
          ).value,
          'Payment response',
        );
        return record(envelope.data, 'Payment');
      },
      (candidate) => TERMINAL_PAYMENT_STATUSES.has(candidate.status),
    );

    if (payment.status === 'AUTHORIZED') {
      const confirmed = orderData(
        (
          await request(`/api/v1/orders/${encodeURIComponent(created.id)}`, {
            headers: bearerHeaders(customer),
          })
        ).value,
        'Confirmed order',
      );

      assert(confirmed.status === 'CONFIRMED', 'Authorized order is not confirmed');
      assert(confirmed.paymentStatus === 'AUTHORIZED', 'Order payment state is inconsistent');
      console.log(
        `[smoke] Idempotent order creation and payment authorization verified (${String(attempt)} attempt)`,
      );
      return confirmed;
    }

    console.log(
      `[smoke] Simulated payment declined; retrying (${String(attempt)}/${String(MAX_ORDER_ATTEMPTS)})`,
    );
  }

  throw new SmokeError('No simulated payment was authorized within the bounded retry limit');
}

async function waitForNotifications(customer, order, expectedTypes) {
  const notifications = await poll(
    'order notifications',
    async () => {
      const envelope = record(
        (await request('/api/v1/notifications', { headers: bearerHeaders(customer) })).value,
        'Notifications response',
      );
      return array(envelope.data, 'Notifications');
    },
    (notifications) => {
      const types = new Set(
        notifications
          .map((candidate) => record(candidate, 'Notification'))
          .filter(
            (notification) =>
              typeof notification.message === 'string' &&
              notification.message.includes(order.orderNumber),
          )
          .map((notification) => notification.type),
      );

      return expectedTypes.every((type) => types.has(type));
    },
  );

  const matching = notifications
    .map((candidate) => record(candidate, 'Notification'))
    .filter(
      (notification) =>
        typeof notification.message === 'string' &&
        notification.message.includes(order.orderNumber),
    );

  for (const type of expectedTypes) {
    assert(
      matching.filter((notification) => notification.type === type).length === 1,
      `Notification side effect is not idempotent for ${type}`,
    );
  }

  return notifications;
}

async function fulfillOrder(admin, customer, order) {
  const shipPath = `/api/v1/admin/orders/${encodeURIComponent(order.id)}/ship`;
  const shipped = orderData(
    (await request(shipPath, { headers: bearerHeaders(admin), method: 'POST' })).value,
    'Shipped order',
  );

  assert(shipped.status === 'SHIPPED', 'Order did not transition to shipped');

  const deliverPath = `/api/v1/admin/orders/${encodeURIComponent(order.id)}/deliver`;
  const delivered = orderData(
    (await request(deliverPath, { headers: bearerHeaders(admin), method: 'POST' })).value,
    'Delivered order',
  );

  assert(delivered.status === 'DELIVERED', 'Order did not transition to delivered');

  const finalOrder = orderData(
    (
      await request(`/api/v1/orders/${encodeURIComponent(order.id)}`, {
        headers: bearerHeaders(customer),
      })
    ).value,
    'Final order',
  );
  const timeline = array(finalOrder.timeline, 'Final order timeline');
  const statuses = new Set(timeline.map((entry) => record(entry, 'Timeline entry').toStatus));

  assert(finalOrder.status === 'DELIVERED', 'Final order status is inconsistent');
  assert(finalOrder.paymentStatus === 'AUTHORIZED', 'Final payment status is inconsistent');
  assert(
    statuses.has('CONFIRMED') && statuses.has('SHIPPED') && statuses.has('DELIVERED'),
    'Order timeline is incomplete',
  );
  console.log('[smoke] Admin shipment, delivery, and final order state verified');
}

async function main() {
  let customer;
  let admin;

  try {
    await verifyHealthAndHomepage();
    customer = await login(
      'Customer',
      process.env['OMS_CUSTOMER_EMAIL'] ?? 'customer@oms.local',
      process.env['OMS_CUSTOMER_PASSWORD'] ?? 'Customer123!',
      'CUSTOMER',
    );
    const sku = await catalogSku();
    const order = await createAuthorizedOrder(customer, sku);

    await waitForNotifications(customer, order, ['order.created', 'payment.authorized']);
    console.log('[smoke] Order and payment notifications verified');

    admin = await login(
      'Administrator',
      process.env['OMS_ADMIN_EMAIL'] ?? 'admin@oms.local',
      process.env['OMS_ADMIN_PASSWORD'] ?? 'Admin123!',
      'ADMIN',
    );
    await fulfillOrder(admin, customer, order);
    await waitForNotifications(customer, order, [
      'order.created',
      'payment.authorized',
      'order.shipped',
      'order.delivered',
    ]);
    console.log('[smoke] Fulfillment notifications verified');

    await logout(admin, 'Administrator');
    await logout(customer, 'Customer');
    console.log('[smoke] PASS: showcase workflow is operational');
  } finally {
    await Promise.allSettled([logout(admin, 'Administrator'), logout(customer, 'Customer')]);
  }
}

main().catch((error) => {
  const message = error instanceof SmokeError ? error.message : 'Unexpected smoke test failure';

  process.stderr.write(`[smoke] FAIL: ${message}\n`);
  process.exitCode = 1;
});
