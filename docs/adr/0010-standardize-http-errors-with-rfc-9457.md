# ADR-0010: Standardize public HTTP errors with RFC 9457

- **Status:** Accepted
- **Date:** 2026-08-22
- **Partially superseded by:** [ADR-0015](0015-authenticate-and-authorize-administrative-apis.md)
  for authenticated `401` handling once its delivery gates are implemented

## Context

NestJS's default error representation includes framework-shaped fields and can
echo an exception message. Exception responses can also be arbitrary objects,
so allowing controllers, guards, parsers, or libraries to define the public
body would create an unstable contract and a data-disclosure boundary.

The API needs one machine-readable error format before business endpoints and
OpenAPI are added. It must preserve request identity, behave correctly for
`HEAD`, cover failures raised before route matching, and keep operational
health separate from the public business API. Application-specific problem
type URLs are not yet supportable because the project has no stable public
documentation origin.

## Decision

Use RFC 9457 Problem Details as the single error representation for the public
HTTP API.

- Register one dependency-injected global exception filter at the API
  composition root.
- Use `about:blank` for generic HTTP failures. Its title is the standard HTTP
  status phrase and its detail is an application-owned fixed sentence.
- Include an opaque occurrence URI, `urn:uuid:<requestId>`, plus `requestId`
  and `correlationId` extension members. Never use the requested URL as the
  occurrence identifier.
- Preserve only statuses in an immutable application-owned descriptor table.
  Unsupported statuses and unexpected values fail closed to a fixed `500`.
- Discard exception messages, `HttpException.getResponse()`, parser bodies,
  causes, stacks, vendor codes, raw URLs, and caller-supplied extensions.
- Recognize only allow-listed parser error type/status pairs. Unknown objects
  carrying `status` or `statusCode` are not HTTP errors.
- Install Pino HTTP and request identity before an explicit 100 KiB JSON body
  parser. This gives safe identity and completion logging to parser rejections
  without collecting request bodies. URL-encoded parsing remains disabled
  until an endpoint has a concrete form-encoding requirement.
- Disable JSON request decompression. Any non-identity `Content-Encoding`
  receives a fixed `415`; compressed request support requires an explicit
  decompression-limit and malformed-stream policy.
- Set `application/problem+json`, `Cache-Control: no-store`, and exact matching
  HTTP/body statuses. Express owns final serialization so `HEAD` suppresses the
  body correctly.
- Preserve only allow-listed platform and status-appropriate HTTP-semantic
  response headers. Representation headers and arbitrary controller headers
  are removed. Statuses whose required header policy is not yet owned,
  including `401` and `405`, are absent from the registry and fail closed to
  `500`.
- Keep expected failed-readiness and graceful-shutdown representations
  unchanged. A method-scoped health filter accepts only the exact known
  Terminus shapes and reconstructs them from constants; every malformed health
  exception becomes a safe Problem Details `500`.
- Domain and application layers do not import or throw NestJS HTTP exceptions.
  Future expected business failures use framework-neutral typed outcomes and
  explicit mappings at the HTTP adapter.

Application-specific problem types will use stable, documented HTTPS URLs only
after the project owns a durable zero-cost documentation origin. The `type`
member is the machine identifier, so the baseline contract does not add a
duplicate `code` field.

## Consequences

### Positive

- Clients receive one predictable and standards-based error shape.
- Exception text and framework response objects cannot become accidental
  public API or leak credentials and internal topology.
- Occurrence IDs support safe log correlation without disclosing paths or query
  values.
- Malformed and oversized bodies are observable under the same request identity
  policy as routed requests.
- The framework boundary remains outside domain and application policy.

### Negative

- Fixed details provide less debugging information to callers; internal
  telemetry must carry safe classifications instead.
- A strict descriptor table and header policy require explicit integration work
  whenever a new HTTP status is introduced.
- `no-store` prevents negative-response caching even where a generic 404 might
  otherwise be cacheable.
- The health exception adapter is deliberately coupled to the current Terminus
  response schema and will fail closed if that dependency contract changes.
- `about:blank` distinguishes generic failures only by status until documented
  domain-specific problem types exist.
- Clients cannot compress JSON request bodies. At the current 100 KiB request
  ceiling, the reduced decompression risk is worth that bandwidth trade-off.

## Alternatives considered

- **Keep NestJS's default JSON errors:** smaller initially, but framework-shaped,
  message-dependent, and unsuitable as a stable public contract.
- **Use a third-party Problem Details package:** saves little code while adding
  another security and versioning boundary around a small adapter.
- **Return exception messages for easier debugging:** rejected because messages
  are not a reviewed API surface and frequently contain sensitive details.
- **Automatically decompress request bodies:** rejected until the API owns both
  decompression resource limits and safe mappings for malformed streams; a
  simple decoded-size limit does not define the whole abuse or alerting policy.
- **Use relative or deployment-host problem type URLs:** rejected because the
  same text would resolve to different identities across paths and environments.
- **Use the request URL as `instance`:** common, but it can expose customer IDs,
  tokens, and query parameters.
- **Bypass the global filter for every `/health` path or every `503`:** rejected
  because path checks are fragile and arbitrary exceptions could escape the
  safe boundary.
- **Return `405` for every unmatched method:** rejected until route-aware
  handling can also generate the required `Allow` header.

## Revisit when

Revisit when the first business failure type is documented, authentication
chooses its challenge scheme, validation errors need structured violations, or
the public documentation origin is available. A future transport adapter may
use the same failure taxonomy without sharing NestJS exceptions.

## References

- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [NestJS exception filters](https://docs.nestjs.com/exception-filters)
- [NestJS request lifecycle](https://docs.nestjs.com/faq/request-lifecycle)
