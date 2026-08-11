import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { secureCookies } from './config.js';
import { db } from './db/index.js';
import { adminUsers } from './db/schema.js';

// One admin: the treasurer. There is no signup route — the first-run setup
// endpoint refuses to run once an admin exists, so an instance exposed to the
// internet before it is configured can be claimed exactly once, by whoever gets
// there first. Put it behind your own auth (Cloudflare Access, VPN, LAN-only)
// if that window matters to you; the README says so too.

const COOKIE = 'teamledger_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error('SESSION_SECRET is not set — refusing to sign sessions with a default');
  }
  return value;
}

export async function adminExists(): Promise<boolean> {
  const rows = await db.select({ id: adminUsers.id }).from(adminUsers).limit(1);
  return rows.length > 0;
}

export async function createAdmin(email: string, password: string) {
  if (await adminExists()) throw new Error('an admin account already exists');
  if (password.length < 8) throw new Error('password must be at least 8 characters');
  const passwordHash = await bcrypt.hash(password, 12);
  const [admin] = await db
    .insert(adminUsers)
    .values({ email: email.toLowerCase().trim(), passwordHash })
    .returning({ id: adminUsers.id, email: adminUsers.email });
  return admin;
}

export async function verifyCredentials(email: string, password: string) {
  const [admin] = await db.select().from(adminUsers).limit(1);
  if (!admin) return null;
  if (admin.email !== email.toLowerCase().trim()) {
    // Still run a hash comparison so a wrong email and a wrong password take
    // the same amount of time.
    await bcrypt.compare(password, admin.passwordHash);
    return null;
  }
  const ok = await bcrypt.compare(password, admin.passwordHash);
  return ok ? { id: admin.id, email: admin.email } : null;
}

export function issueSession(res: Response, admin: { id: number; email: string }) {
  const token = jwt.sign({ sub: String(admin.id), email: admin.email }, secret(), {
    expiresIn: '30d',
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Explicit opt-in, never inferred from NODE_ENV: a LAN self-hoster running
    // NODE_ENV=production over plain http would get a cookie the browser accepts
    // and then refuses to send back, bouncing them off the login form with no
    // error to explain it. See config.ts.
    secure: secureCookies,
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  try {
    const payload = jwt.verify(token, secret()) as { sub: string; email: string };
    (req as Request & { admin?: { id: number; email: string } }).admin = {
      id: Number(payload.sub),
      email: payload.email,
    };
    next();
  } catch {
    res.status(401).json({ error: 'session expired' });
  }
}
