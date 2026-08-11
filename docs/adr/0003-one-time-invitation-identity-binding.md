# ADR 0003: Bind Human Membership with one-time invitations

Status: Accepted

## Decision

Use the stable random account UUID returned by Cloudflare OS as the Guild Human Identity ID. Do not
create a database Identity merely because an account opens the Guild application. A Human with
`membership.manage` issues a 32-byte random invitation for one Role, optional Space, initial
Membership state, and expiry. The plaintext token is displayed once; PostgreSQL stores only its
SHA-256 hash. Acceptance locks the row and creates or promotes the account-bound Human in the same
transaction as its Role binding and Chronicle event.

## Why

The pinned upstream `GatekeeperVendor.createAccount()` contract does not provide a verified email or
Access subject. A self-declared email would allow impersonation. Automatic Preboarding enrollment
would permit untrusted account traffic to grow the database and would not prove administrator
intent. A high-entropy capability token binds that intent without introducing a seller-owned
identity service.

## Alternatives considered

- Self-declared email: rejected because it is not authentication evidence.
- Insert every Cloudflare OS account into Preboarding: rejected because it permits database spam and
  leaves administrator intent ambiguous.
- Patch upstream Cloudflare OS to pass Access claims: deferred because it creates a private fork and
  is unnecessary for secure membership binding.

## Risks and rollback

Invitation recipients must receive the token through an appropriate private channel. Compromise
before acceptance lets the holder claim the intended role, so tokens expire, are one-use, and may be
revoked. Rollback is to disable invitation issuance and retain existing account UUID bindings; no
email-based fallback is permitted.
