# Security policy

## Reporting a vulnerability

Please report security issues **privately** rather than opening a public issue.

Use GitHub's private vulnerability reporting:
**https://github.com/raymondoooo/teamledger/security/advisories/new**

That creates a private thread visible only to the maintainer. Please include what
you found, how to reproduce it, and what an attacker could achieve.

This is a hobby project maintained by one person, so I can't promise a response
time — but I'd rather hear about a problem late than read about it in someone
else's bug tracker. Please give me a reasonable window to ship a fix before
disclosing publicly.

## What this app assumes about its environment

teamledger is built for a **single trusted administrator on a network you
control**. Being explicit about the things it deliberately does not do:

- **Login rate limiting is per-IP and in-memory.** 10 failed attempts per 15
  minutes by default. It resets when the container restarts, and with
  `TRUST_PROXY` off every client shares one bucket — blunt, but it cannot be
  bypassed by forging a header.
- **The setup screen is claimable by whoever reaches it first.** A freshly
  started instance has no admin account, and the first person to load it creates
  one. After that the endpoint refuses, but the window is real.
- **There is one account and no second factor.** No password reset, no email
  verification, no audit log of who changed what.
- **Anyone with the admin password sees everything**, including parents' email
  addresses and phone numbers.

Run it on your LAN, behind a VPN (Tailscale, WireGuard), or behind an
authenticating reverse proxy (Cloudflare Access, Authelia, oauth2-proxy). Do not
expose it directly to the internet and walk away from it.

## Things it does get right

- Passwords are hashed with bcrypt (cost 12), never stored or logged in plain text.
- The session is a signed JWT in an `httpOnly`, `SameSite=Lax` cookie, with
  `Secure` controlled by the explicit `SECURE_COOKIES` setting. It is deliberately
  **not** derived from `NODE_ENV`: inferring it would silently lock LAN users out
  of their own instance with no error to explain why.
- `TRUST_PROXY` defaults to off, so `X-Forwarded-For` cannot be forged to escape
  the login rate limiter. CI regression-tests this with 16 rotating addresses.
- The app survives its database restarting rather than crashing on an unhandled
  pool error, and reports `503` from `/api/health` while degraded.
- Migrations are forward-only, and the app **refuses to start** if the database
  reports a newer schema than the image understands, rather than writing into a
  shape it does not know.
- The server refuses to start if `SESSION_SECRET` is unset rather than falling
  back to a default signing key.
- Every route except `/api/health`, `/api/setup/status`, `/api/setup`,
  `/api/auth/login` and `/api/auth/logout` requires a valid session. This is covered by a CI test, not
  just by inspection.
- Database access goes through parameterised queries (Drizzle ORM); no user
  input is concatenated into SQL.
- The container runs as a non-root user and ships no compiler or build
  toolchain. Both are enforced in CI.
- Dependencies are kept current; `npm audit` is clean of high and critical
  advisories at release.

## Supported versions

The latest tagged release only. This is a small project — please upgrade rather
than asking for a backport.
