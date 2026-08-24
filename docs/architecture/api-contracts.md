# HTTP API contracts

## Conventions

- Application base path: `/api/v1`
- Operational paths: `/health/live` and `/health/ready` (unversioned)
- JSON request limit: 100 KiB
- Request validation: allow-listed fields only; malformed or unknown fields return 400
- Authenticated endpoints: `Authorization: Bearer <access-token>`
- Administrative endpoints: authenticated user must have role `ADMIN`
- Feature success envelope: `{ "data": ... }`
- Auth success responses are direct objects because they also establish/rotate browser credentials
- Error content type: `application/problem+json`
- All money values in API responses are decimal strings such as `"1299.00"`
- All timestamps are ISO 8601 UTC strings
- Identifiers are UUID strings

Swagger UI is at `/docs`; the machine-readable OpenAPI document is at `/docs/openapi.json`. The checked-in code is authoritative when this document and generated OpenAPI disagree.

## Authentication and session contract

### Credential channels

The access token is returned in JSON and sent as a bearer token. It expires after 15 minutes. The refresh token is never returned to JavaScript; it is stored in the `oms_refresh` cookie with:

- `HttpOnly`
- `SameSite=Strict`
- `Secure` in production
- path `/api/v1/auth`
- 30-day maximum lifetime

Refresh and logout also require the current `X-CSRF-Token` returned by the most recent register/login/refresh response. Refresh rotates all three credentials.

### Auth endpoints

| Method and path | Access | Request | Success |
| --- | --- | --- | --- |
| `POST /auth/register` | public | `RegisterRequest` | 201, `AuthSession`, sets refresh cookie |
| `POST /auth/login` | public | `LoginRequest` | 200, `AuthSession`, sets refresh cookie |
| `POST /auth/refresh` | refresh cookie + CSRF header | no body | 200, rotated `AuthSession`, replaces cookie |
| `POST /auth/logout` | refresh cookie + CSRF header | no body | 204, revokes session and clears cookie |
| `GET /auth/me` | bearer | none | 200, `User` |

```ts
type RegisterRequest = {
  email: string;       // valid email, 3..191 characters
  displayName: string; // 2..120 characters, trimmed display-name character set
  password: string;    // 12..128 characters
};

type LoginRequest = {
  email: string;
  password: string;
};

type User = {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'CUSTOMER';
  roles: Array<'ADMIN' | 'CUSTOMER'>;
  permissions: string[]; // empty until permission authorization is implemented
};

type AuthSession = {
  accessToken: string;
  accessTokenExpiresAt: string;
  csrfToken: string;
  tokenType: 'Bearer';
  user: User;
};
```

Login is limited to ten attempts per normalized email digest in five minutes. Invalid credentials return the same 401 response whether or not the account exists. Redis unavailability returns 503 for login rather than bypassing throttling.

## Catalog contract

Public Catalog responses include only ACTIVE SKUs under ACTIVE Products.

| Method and path | Access | Request | Success data |
| --- | --- | --- | --- |
| `GET /catalog/products?limit=50` | public | optional limit 1..100 | `Product[]` |
| `GET /catalog/skus?limit=50&productId=<uuid>` | public | optional filters | `Sku[]` |
| `GET /catalog/skus/:id` | public | SKU UUID | `Sku` |
| `POST /admin/products` | admin | `CreateProductRequest` | `Product` |
| `PATCH /admin/products/:id` | admin | `UpdateProductRequest` | `Product` |
| `POST /admin/products/:productId/skus` | admin | `CreateSkuRequest` | `Sku` |
| `PATCH /admin/skus/:id` | admin | `UpdateSkuRequest` | `Sku` |

```ts
type CatalogStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

type CreateProductRequest = {
  name: string;         // 2..160
  description: string;  // 1..500
  status?: CatalogStatus;
};

type UpdateProductRequest = {
  name?: string;
  description?: string;
  status?: CatalogStatus;
  version: number;      // positive optimistic-concurrency version
};

type CreateSkuRequest = {
  code: string;         // 2..64, uppercase letters/digits/._-
  name: string;         // 2..160
  price: string;        // non-negative decimal with exactly two fraction digits
  currency: string;     // three uppercase letters
  status?: CatalogStatus;
};

type UpdateSkuRequest = {
  name?: string;
  price?: string;
  currency?: string;
  status?: CatalogStatus;
  version: number;
};

type Product = {
  id: string;
  name: string;
  description: string;
  status: CatalogStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type Sku = {
  id: string;
  code: string;
  name: string;
  description: string; // current Product description
  price: string;
  currency: string;
  available: number;   // sum across warehouses
  version: number;
  product: { id: string; name: string };
};
```

Updates use compare-and-swap on `version`. A stale version returns 409. Activating a SKU whose Product is not ACTIVE also returns 409.

## Inventory contract

| Method and path | Access | Request | Success data |
| --- | --- | --- | --- |
| `GET /inventory/:skuId` | public | SKU UUID | `InventoryItem[]`, one per warehouse |
| `GET /inventory` | admin | none | `InventoryItem[]` |
| `POST /inventory/:skuId/adjust` | admin | `InventoryAdjustmentRequest` | `InventoryItem` |

```ts
type InventoryAdjustmentRequest = {
  quantityDelta: number; // integer -1,000,000..1,000,000
  reason: string;        // 3..100
  warehouseId?: string;  // required when the SKU exists in multiple warehouses
};

type InventoryItem = {
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
};
```

An adjustment that would make available or on-hand inventory negative returns 409. Every successful adjustment writes an inventory movement in the same transaction.

## Order and payment contract

### Create order

`POST /orders` requires a bearer token and an `Idempotency-Key` header matching:

```text
^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$
```

Request:

```ts
type CreateOrderRequest = {
  items: Array<{
    skuId: string;
    quantity: number; // integer 1..100 per submitted line
  }>;                 // 1..25 lines
  shippingAddress: {
    line1: string;      // 3..160
    city: string;       // 2..80
    state: string;      // 2..80
    postalCode: string; // 3..20
    country: string;    // country label/code accepted by the current API
  };
};
```

Duplicate SKU lines are normalized before persistence. Repeating the same key with the same normalized request returns the original order. Reusing it for different content returns 409. Insufficient stock or an inactive SKU also returns 409.

### Order endpoints

| Method and path | Access | Success data |
| --- | --- | --- |
| `POST /orders` | bearer | `Order` |
| `GET /orders` | bearer | customer sees own orders; admin sees up to 100 recent orders |
| `GET /orders/:orderId` | bearer | own order, or any order for admin |
| `POST /orders/:orderId/cancel` | bearer | cancelled `Order` |
| `GET /orders/:orderId/payment` | bearer | `Payment` |
| `POST /admin/orders/:orderId/ship` | admin | shipped `Order` |
| `POST /admin/orders/:orderId/deliver` | admin | delivered `Order` |
| `POST /payments/:paymentId/refund` | admin | refunded `Payment` |

Ownership failures return 404 rather than revealing another customer's order.

```ts
type Order = {
  id: string;
  orderNumber: string;
  status:
    | 'PENDING_PAYMENT'
    | 'CONFIRMED'
    | 'PROCESSING'
    | 'SHIPPED'
    | 'DELIVERED'
    | 'CANCELLED'
    | 'PAYMENT_FAILED';
  paymentStatus: 'PENDING' | 'AUTHORIZED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  currency: string;
  total: string;
  customerName: string;
  customerEmail: string;
  shippingAddress: CreateOrderRequest['shippingAddress'];
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    skuId: string;
    skuCode: string;
    skuName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
  timeline: Array<{
    id: string;
    fromStatus: Order['status'] | null;
    toStatus: Order['status'];
    reason: string | null;
    createdAt: string;
  }>;
  payment: Payment | null;
};

type Payment = {
  id: string;
  status: 'PENDING' | 'AUTHORIZED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  provider: string;
  providerReference: string | null;
  amount: string;
  currency: string;
  authorizedAt: string | null;
  refundedAt: string | null;
};
```

The simulator authorizes approximately 80% of orders using a deterministic hash of the order ID. This makes success and failure reproducible in tests; it is not a payment-provider guarantee.

## Notification contract

| Method and path | Access | Success data |
| --- | --- | --- |
| `GET /notifications` | bearer | current user's latest `Notification[]` |
| `PATCH /notifications/:notificationId/read` | bearer | updated `Notification` |

```ts
type Notification = {
  id: string;
  type: string;       // originating event type
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};
```

Trying to mutate another user's notification returns 404.

## Error contract

Except for operational health responses, all handled failures use the same sanitized shape:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "The request conflicts with the current resource state.",
  "instance": "urn:uuid:00000000-0000-4000-8000-000000000000",
  "requestId": "00000000-0000-4000-8000-000000000000",
  "correlationId": "00000000-0000-4000-8000-000000000000"
}
```

Supported statuses include 400, 401, 403, 404, 408, 409, 413, 415, 422, 429, 500, 502, 503, and 504. Server exception messages, SQL details, secrets, and DTO field values are not returned.

Clients may send `X-Correlation-Id` as a UUIDv4. The API always returns request and correlation identifiers so an operator can join a user-visible error to structured logs.

## Compatibility policy

- Breaking transport changes require a new URI version.
- Adding an optional response field is compatible, but the web runtime validator must be updated deliberately.
- Event schemas evolve independently from HTTP and need consumer compatibility tests before service extraction.
- Status-enum additions are potentially breaking for exhaustive clients and must be announced.
- Removing a field or changing money/timestamp representation is breaking.
