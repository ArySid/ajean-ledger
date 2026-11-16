import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID-like id: 10 chars of millisecond time + 16 random chars (Crockford base32), sortable by time. */
export function ulid(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

export function newRequestId(): string {
  return `req_${ulid()}`;
}

export const REQUEST_ID_RE = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;

export function isRequestId(id: string): boolean {
  return REQUEST_ID_RE.test(id);
}
