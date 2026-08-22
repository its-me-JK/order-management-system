# ADR-0017: Use split browser session credentials

- **Status:** Accepted
- **Date:** 2026-08-23
- **Refines:** the Identity HTTP delivery gate in
  [ADR-0015](0015-authenticate-and-authorize-administrative-apis.md)

## Context

ADR-0015 selects opaque access and rotating refresh credentials, but
deliberately leaves their HTTP transport, browser security, concurrency, and
abuse behavior unresolved. Those details are part of the security boundary.
Implementing a login controller before deciding them would make cookie scope,
CSRF, CORS, token persistence, and revocation accidental framework behavior.

The first client is a browser-based administrative console. Command-line
clients are also useful for local operation and verification. The deployment
must remain compatible with the zero-cost showcase, but that constraint cannot
justify putting credentials in browser storage, weakening cookies, or using
Redis as authoritative session state.

## Decision

The API uses split credentials:

- a short-lived opaque access credential is returned in the login or refresh
  JSON response and is sent only in the `Authorization: Bearer` header;
- a rotating opaque refresh credential is returned only as the
  `__Host-oms-refresh` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`,
  `Path=/`, and no `Domain`; and
- browser code holds an access credential only in memory. It never stores an
  access or refresh credential in `localStorage`, `sessionStorage`, IndexedDB,
  a URL, or a non-HttpOnly cookie.

Access and refresh credentials have different versioned prefixes followed by
32 CSPRNG bytes encoded without Base64 padding. MySQL stores only SHA-256
digests of complete serialized credentials. Prefixes provide type separation
and operational recognition; they do not replace entropy. Raw values are
never stored, logged, placed in events, or returned by a read endpoint.

The reviewed lifetime defaults are 15 minutes for access, one hour of refresh
inactivity, and seven days of absolute refresh-family life. Refresh extends
the idle deadline but never the absolute deadline. These values are validated
configuration with conservative bounds. The refresh cookie is a browser-session
cookie with no positive `Max-Age` or `Expires`; MySQL deadlines remain
authoritative even if a browser restores session cookies after restart.

Login, refresh, logout, and current-session routes live under `/api/v1/auth`.
Login and refresh return a new access credential; login creates a session
family and refresh rotates that family's one current refresh credential.
Logout revokes only the presented family. Account suspension, deactivation,
and password replacement revoke every active family for the account.
Permission and role changes need no token rewrite because every privileged
request resolves current authority from MySQL.

Refresh rotation is strict. A consumed refresh credential presented while its
family could still be active revokes the complete family. Two concurrent
refreshes can therefore cause the losing request to revoke the session, and a
retry after a committed response was lost has the same result. Clients must
serialize refresh, including across browser tabs. We prefer a fail-secure
re-login over a replay grace period or recoverable storage of a raw successor.

All three Identity POSTs—credential-issuing login and refresh plus
cookie-authenticated logout—require the fixed non-simple `X-OMS-CSRF: 1`
header. Credentialed CORS uses only exact configured origins, never `*`; an
`Origin` value must match, and `Sec-Fetch-Site: cross-site` is rejected when
Fetch Metadata is present. The custom header is not a secret. It forces
browser cross-origin JavaScript through CORS preflight and cannot be added by a
plain cross-site form. These controls are layered with `SameSite=Strict`; none
is treated as the sole CSRF defense.

The initial deployed administrative console and API must be same-origin.
Local development may use one exact same-site localhost origin through the
reviewed credentialed CORS policy. An unrelated frontend origin is
intentionally incompatible with the Strict refresh cookie. A zero-cost
deployment must proxy or serve the console through the API origin rather than
switching to `SameSite=None` merely to accommodate provider URLs.

Command-line clients use the same contract: they retain the HttpOnly cookie in
a protected cookie jar, send the CSRF header, and keep the access credential
out of command history. Refresh credentials are not returned in JSON. A future
machine-to-machine client receives a separate non-password, non-cookie
contract; it does not weaken this browser flow.

Login and refresh require a Redis-backed, atomic, multi-dimensional abuse
decision before password hashing or credential issuance. Candidate login,
network, presented credential, and deployment-wide buckets use keyed,
pseudonymous Redis keys. Redis denial is a fixed `429`; Redis timeout,
unavailability, or an indeterminate decision is a fixed `503`. Those routes
fail closed. Logout, Bearer resolution, anonymous Catalog reads, and global API
readiness do not depend on Redis.

Redis is the distributed fast-admission layer, not the only password-guessing
record. The password credential retains a bounded consecutive-failure counter
and a capped next-verification deadline in MySQL, so Redis eviction or
replacement cannot silently reset all protection. Exponential cooldown adds a
temporary denial risk. At the current NIST maximum of 100 consecutive failures,
the password authenticator—not the Account—becomes `REBIND_REQUIRED`; existing
sessions are not revoked by attacker-controlled failures. It can return only
through the exact offline, control-plane-authenticated password-rebind command,
which replaces the authenticator and revokes sessions atomically. This creates
a deliberate operator-recovery denial-of-service risk for a known login, so
the much lower Redis limits and alerts apply first.

Password establishment follows current NIST guidance: at least 15 Unicode code
points for the initial single factor, at least 64 supported, no composition
rules, no silent trimming or truncation, no periodic rotation, NFC before
hashing, and a versioned local blocklist of common or compromised values.
Argon2id parameters are stored in the PHC value, may be upgraded after a
successful verification, and cannot be configured below current OWASP
guidance. Password verification and rehash computation occur outside a
database transaction.

Missing, malformed, expired, or revoked Bearer access credentials on protected
resources receive one fixed `401` Problem Details representation and
`WWW-Authenticate: Bearer realm="oms-api"`. Login and refresh are credential
exchange operations, not Bearer-protected resources; their unknown, wrong,
inactive, missing, expired, revoked, and replayed cases use fixed `400`
failures without a challenge. Invalid refresh and completed logout responses
clear the refresh cookie through an Identity-owned response path; the generic
error writer never preserves arbitrary `Set-Cookie` values.

This decision does not authorize route registration. The exact DTOs, response
schemas, failures, Redis limits, transaction rules, OpenAPI, trusted-ingress
policy, and tests are defined in the
[Identity and session contract](../architecture/identity-and-session.md). All
delivery gates in that contract must ship together.

## Consequences

### Positive

- XSS cannot read the long-lived refresh credential, while CSRF cannot attach
  the in-memory Bearer credential to administrative commands.
- MySQL remains authoritative for immediate suspension, revocation, and
  permission changes.
- Rotation detects refresh replay without storing a recoverable raw token.
- Browser and CLI clients share one reviewed transport without putting a
  refresh secret in JSON.
- Strict same-origin deployment reduces ambient cookie exposure and future
  third-party-cookie incompatibility.
- A browser restart normally removes the refresh credential even though the
  server retains a bounded absolute session record.

### Negative

- Browser refresh requires coordinated single-flight behavior across tabs.
- A lost refresh response or concurrent refresh can force a legitimate user
  to authenticate again.
- Every privileged request pays for a bounded MySQL authority lookup.
- Credential issuance is unavailable during a Redis outage even if MySQL and
  anonymous reads remain healthy.
- A separately hosted frontend on an unrelated provider domain cannot use the
  refresh cookie.
- Password-only authentication is not phishing-resistant; real privileged
  production use still requires MFA or a reviewed external identity provider.
- Returning an access credential to browser JavaScript still permits an XSS to
  steal its remaining short lifetime.
- A sufficiently persistent attacker who knows an administrator login can
  force the password authenticator to its mandatory offline-rebind state even
  though lower Redis limits make that slow and observable.

## Alternatives considered

- **Bearer access and refresh credentials in browser storage:** simpler client
  code, but one XSS obtains the long-lived credential.
- **Both credentials in HttpOnly cookies:** reduces token access from
  JavaScript but makes every authenticated mutation cookie-authenticated and
  expands the CSRF boundary.
- **A single opaque session cookie:** operationally simple, but loses the
  short-lived access boundary expected by future non-browser clients and
  extracted services.
- **JWT access credentials:** avoid the authority lookup, but delay permission
  and revocation changes and introduce signing-key and claim-version policy
  before the monolith needs offline verification.
- **`SameSite=None` refresh cookie:** supports unrelated frontend and API
  origins, but expands CSRF and third-party-cookie exposure for a deployment
  topology we control.
- **Refresh replay grace period:** reduces accidental logout, but safely
  replaying a successor requires storing or deriving a recoverable raw secret
  and gives an attacker a grace window.
- **Redis sessions:** fast, but eviction or outage cannot be allowed to change
  authoritative security state.
- **Cooldown forever with no hard disable:** avoids operator recovery denial of
  service, but violates the selected NIST failed-attempt ceiling and lets a
  durable authenticator continue accepting guesses indefinitely.

## Revisit when

Revisit the split only if a measured browser threat model favors a Backend for
Frontend, or an independently deployed service needs offline access-token
validation. Revisit strict same-origin deployment only with a reviewed origin
topology and equivalent CSRF and privacy controls. Before real privileged
production use, add phishing-resistant MFA or federated OIDC and recovery,
step-up, and authenticator-lifecycle contracts. No privileged browser UI ships
until a separate threat-model decision accepts this token-mediating profile or
selects a full Backend for Frontend that keeps access credentials out of
JavaScript.

## References

- [RFC 6750: Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750.html)
- [RFC 6749: OAuth 2.0 token error semantics](https://www.rfc-editor.org/rfc/rfc6749.html#section-5.2)
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [RFC 10017: OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html)
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Fetch Metadata Request Headers](https://www.w3.org/TR/fetch-metadata/)
- [Cookies: HTTP State Management Mechanism draft](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
