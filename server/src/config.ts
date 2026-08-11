// Settings that are security boundaries, kept in one place so their defaults are
// visible rather than scattered through the code as inline `process.env` reads.
//
// Both default to OFF. Each was chosen because the failure mode of the wrong
// default is worse than the inconvenience of the right one.

function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

// Whether to believe X-Forwarded-For.
//
// OFF by default. With no real proxy in front, trusting that header lets anyone
// forge it, and a per-IP login limiter becomes unlimited guesses — rotate the
// header, get a fresh bucket every request. Off is blunt (everyone shares one
// bucket) but it cannot be bypassed. Turn it on only when a proxy you control
// is genuinely setting the header.
export const trustProxy = envFlag('TRUST_PROXY');

// Whether session cookies carry the Secure flag.
//
// OFF by default, and deliberately NOT derived from NODE_ENV. A LAN self-hoster
// running production over plain http would be issued a cookie the browser
// accepts and then refuses to send back: they sign in, land on the login form
// again, and see no error at all. Turn this on when you have TLS in front.
export const secureCookies = envFlag('SECURE_COOKIES');

// Failed logins allowed per window before the endpoint starts refusing.
export const loginRateLimit = {
  windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS ?? 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_MAX ?? 10),
};
