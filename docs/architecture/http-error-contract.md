# HTTP error contract

## Scope

This contract applies to errors produced by the public HTTP API, including
NestJS routing failures, allow-listed transport failures, and unexpected
exceptions. Domain and application code return typed outcomes; the HTTP adapter
chooses status, problem type, and headers.

Operational health is a deployment contract and retains its separate sanitized
representation. Malformed HTTP rejected by Node.js before the Express
application cannot receive application headers or Problem Details.

## Baseline representation

Every ordinary HTTP error uses RFC 9457 `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "The requested resource was not found.",
  "instance": "urn:uuid:3edb6dcb-091f-4acb-b3a0-787f61f2deab",
  "requestId": "3edb6dcb-091f-4acb-b3a0-787f61f2deab",
  "correlationId": "3edb6dcb-091f-4acb-b3a0-787f61f2deab"
}
```

The baseline has exactly seven members:

| Member | Contract |
| --- | --- |
| `type` | `about:blank` until a documented application-specific type exists |
| `title` | Fixed recommended phrase for the HTTP status |
| `status` | Exactly equal to the actual HTTP response status |
| `detail` | Fixed application-owned guidance; never exception text |
| `instance` | Opaque, non-dereferenceable `urn:uuid:<requestId>` occurrence ID |
| `requestId` | Server-owned UUIDv4 for this HTTP hop |
| `correlationId` | Validated UUIDv4/v7 caller lineage or request-ID fallback |

JSON member order is not contractual. Clients use `type` as the primary machine
identifier and must not parse `title` or `detail`. No duplicate `code` member is
added because it could drift from `type`.

## Response semantics

An error response sends:

- the descriptor's HTTP status;
- `Content-Type: application/problem+json; charset=utf-8`;
- `Cache-Control: no-store`;
- `X-Request-Id` and `X-Correlation-Id` matching the body; and
- no representation body for `HEAD`, while retaining equivalent status and
  headers.

The API returns Problem Details even when `Accept` omits its media type. Content
negotiation and localization are deferred; fixed strings are English. `no-store`
prevents caches from reusing a response containing occurrence-specific IDs.

The writer clears prior representation and arbitrary response headers. It
preserves only request identity, CORS and security policy, and semantic headers
that are valid for the selected status. For example, `Retry-After` survives
only `429` or `503`, and rate-limit fields survive only `429`. Headers are never
copied from an exception object. Express-generated ETags are disabled globally;
optimistic concurrency will use application-owned validators later.

`401` is deliberately absent until the authentication adapter owns a fixed,
validated `WWW-Authenticate` challenge. Route-aware `405` is also deferred
because a correct response must provide `Allow`. Either status currently fails
closed to the fixed `500` representation, even when arbitrary upstream code
sets those headers.

[ADR-0015](../adr/0015-authenticate-and-authorize-administrative-apis.md)
accepts the future administrative Bearer challenge and typed `401` contract.
The paragraph above remains the current runtime behavior until Identity, the
expanded descriptor registry, exact OpenAPI, and all route-registration gates
are implemented together.

## Generic descriptor registry

`about:blank` states that a problem has no semantics beyond its HTTP status.
The initial immutable registry is:

| Status | Title | Fixed detail |
| ---: | --- | --- |
| 400 | Bad Request | The request is invalid. |
| 403 | Forbidden | You are not allowed to perform this operation. |
| 404 | Not Found | The requested resource was not found. |
| 408 | Request Timeout | The request did not complete within the allowed time. |
| 409 | Conflict | The request conflicts with the current resource state. |
| 413 | Content Too Large | The request content exceeds the allowed size. |
| 415 | Unsupported Media Type | The request media type is not supported. |
| 422 | Unprocessable Content | The request is well formed but cannot be processed. |
| 429 | Too Many Requests | Too many requests were received. Retry later. |
| 500 | Internal Server Error | The service could not complete the request. |
| 502 | Bad Gateway | An upstream service returned an invalid response. |
| 503 | Service Unavailable | The service is temporarily unavailable. |
| 504 | Gateway Timeout | An upstream service did not respond in time. |

Unsupported, non-integer, 2xx, 3xx, or caller-spoofed statuses become the fixed
`500` descriptor.

## OpenAPI and validation

The OpenAPI `ProblemDetails` component has exactly the seven baseline members
as required properties and rejects additional members. Status-specific
components narrow fixed `status`, `title`, and `detail` values instead of
claiming that every registry status is possible from every operation. Future
operations reference these shared components while declaring only failures
they can actually produce.

Strict DTO failures use the fixed `400` descriptor. The response and logs do
not contain rejected values, field names, constraint names, or the validator's
internal error tree. Controlled structured violations remain a future contract
decision; raw class-validator output will never be exposed. See
[OpenAPI and transport validation](openapi-and-transport-validation.md).

## Failure taxonomy and mapping

### Transport and framework failures

The boundary may preserve an allow-listed status from a genuine NestJS
`HttpException`, but it always discards `getResponse()` and the message. Any
framework `5xx` remains unexpected even when its safe status is preserved.
Parser failures are recognized only when an `Error` has a known parser-owned
type and the corresponding exposed status. Current categories cover invalid
syntax or request size, unsupported charset or encoding, oversized content,
and aborted parsing.

Pino HTTP and request identity run before the explicit JSON parser. The parser
has an application-owned 102,400-byte limit. Valid bodies continue to Nest
routing; parser failures receive safe identity, a low-cardinality completion
record, and Problem Details without body collection while the connection is
writable. A client disconnect during parsing produces one sanitized abort
warning and no attempted recovery response. Request decompression is disabled:
any non-identity `Content-Encoding`, including gzip, Brotli, or deflate, receives
a fixed `415`. URL-encoded parsing is disabled until an endpoint explicitly
needs form input.

### Expected application failures

Business code must not throw `HttpException`. A use case returns a typed,
framework-neutral failure such as a conflict or missing aggregate. The HTTP
adapter maps each variant explicitly to a documented problem type and status.
No generic "business exception with message" is allowed.

### Dependency failures

Repository and provider adapters translate known failures into application
categories only when a use case can act on them. Prisma, MySQL, Redis, RabbitMQ,
or payment-provider errors never reach this filter as public metadata. A future
explicit mapping may produce `503` or `504` and a validated `Retry-After`.

### Unexpected failures

Every other thrown value becomes the fixed `500`. Objects that merely contain
`statusCode`, `message`, or similar fields are untrusted. One sanitized
`http.exception.unexpected` event is emitted in addition to the HTTP completion
record. Logs retain only safe error classification and request context.

If headers are already committed, HTTP cannot safely replace the representation
or status. The filter emits the sanitized event and ends an incomplete response
without appending JSON. Throwing after a response has fully ended is also logged
as an unexpected programming failure, regardless of the exception's nominal
status. A client-destroyed connection remains an abort, not an application
error. Streaming endpoints must document this limitation.

## Operational health exception

Expected `GET /health/ready` dependency failure remains:

```json
{
  "status": "error",
  "info": {},
  "error": { "database": { "status": "down" } },
  "details": { "database": { "status": "down" } }
}
```

It keeps HTTP `503`, `application/json`, and
`Cache-Control: no-cache, no-store, must-revalidate`. During graceful shutdown,
the same method-scoped filter also accepts only the known `shutting_down`
variants: empty component maps for liveness, or a database marked exactly `up`
or `down` for readiness. It rejects extra fields, accessors, proxies, and
inconsistent shapes, then returns canonical constants rather than the exception
object. An unexpected health error or changed Terminus shape fails closed to
the ordinary Problem Details `500`. No path-prefix or generic-503 bypass
exists.

## Security rules

Responses never include raw path, query, method, timestamp, request or response
body, headers, cookies, DTOs, stack, cause, exception message, vendor result,
database details, or caller-defined Problem Details members. The correlation ID
is validated before echoing; the request ID is always server-owned.

The filter is a last-resort transport boundary, not permission to throw
sensitive objects. Modules still translate expected failures deliberately and
avoid collecting secrets in the first place.

## Why this design

- RFC 9457 gives clients a standard envelope while allowing future typed domain
  extensions.
- Fixed allow-listed mappings make the security boundary reviewable and keep
  framework upgrades from changing the public contract.
- An opaque instance URI supports safe correlation without revealing the
  requested resource.
- Early identity and logging make hostile parser traffic observable without
  body capture.
- A narrow health filter preserves orchestrator semantics without allowing
  operational payloads to bypass the public error boundary.

## Alternatives and trade-offs

- NestJS defaults require less code but expose framework behavior and thrown
  messages as public API.
- A third-party adapter adds a dependency without removing the need for local
  status, header, health, and disclosure policy.
- Returning raw validation or exception text is convenient during development
  but creates client coupling and disclosure risk.
- Custom type URLs today would be more expressive but unstable. Waiting means
  generic failures are distinguishable only by status for now.
- `no-store` and disabled automatic ETags sacrifice automatic negative caching;
  reviewed caching and concurrency semantics can be added per resource later.
- Rejecting compressed request bodies avoids malformed-stream and decompression
  resource ambiguity, but clients cannot trade CPU for request bandwidth. This
  can be revisited with explicit compressed and expanded-size limits.
- Strict health canonicalization makes dependency drift visible as a `500`, but
  a Terminus upgrade can require an intentional contract update.

## Interview questions

1. **Why is `type` the machine identifier?** RFC 9457 defines it as the stable
   problem identity; titles and details are human-readable and may change or be
   localized.
2. **Why must body and HTTP status agree?** Intermediaries and generic clients
   act on the HTTP status, while persisted bodies may use the member. A producer
   must not create two conflicting meanings.
3. **Why is `instance` not the request URL?** Request targets commonly contain
   customer identifiers and query secrets; an opaque occurrence ID is safer.
4. **Why not throw `HttpException` from the domain?** HTTP is one delivery
   adapter. Framework-neutral outcomes preserve Clean Architecture and can be
   mapped differently for workers or future transports.
5. **Why are parser type and status both checked?** Trusting `statusCode` on an
   arbitrary object lets application or hostile values masquerade as expected
   protocol failures.
6. **Why are `401` and `405` deferred?** Their required challenge and allowed
   method metadata must come from an owning adapter; preserving an integer
   without those semantics would create an invalid protocol response.
7. **Why is failed readiness not Problem Details?** It is an orchestrator
   representation of component health, not a public business API problem.

## Future improvements

- Publish stable application-specific problem types on GitHub Pages.
- Add structured, controlled validation violations only when a client needs
  them and the disclosure policy is defined.
- Enforce response completeness for every future business operation using the
  shared OpenAPI components and explicit `application/problem+json` content.
- Add authentication challenge, rate-limit, retry, idempotency-conflict, and
  optimistic-concurrency policies with their required headers.
- Add route-aware `405`, localization, and content negotiation only when clients
  need them.
- Define equivalent typed failure envelopes for worker and RabbitMQ boundaries.

## References

- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [NestJS exception filters](https://docs.nestjs.com/exception-filters)
- [NestJS request lifecycle](https://docs.nestjs.com/faq/request-lifecycle)
