import type { ModerationAccountDetail } from './types';

// The known-IP list shown in an account's moderation detail: newest first (last login,
// then recent sessions), capped, but any IP this account has blocked is always included
// so Unblock stays reachable past the cap. Pure + testable; ported from the old
// renderIpBlockSection. `isLast` marks the most-recent IP for the "last login" hint.
const MAX_KNOWN_IPS = 5;

export interface KnownIp {
  ip: string;
  blocked: boolean;
  isLast: boolean;
}

export function knownAccountIps(d: ModerationAccountDetail): KnownIp[] {
  const blocked = new Set(d.blockedIps);
  const ips: string[] = [];
  const seen = new Set<string>();
  const add = (ip: string | null) => {
    if (ip && !seen.has(ip) && ips.length < MAX_KNOWN_IPS) {
      seen.add(ip);
      ips.push(ip);
    }
  };
  add(d.account.lastLoginIp);
  for (const s of d.account.recentSessions) add(s.ip);
  for (const ip of d.blockedIps) {
    if (!seen.has(ip)) {
      seen.add(ip);
      ips.push(ip);
    }
  }
  return ips.map((ip, i) => ({ ip, blocked: blocked.has(ip), isLast: i === 0 }));
}
