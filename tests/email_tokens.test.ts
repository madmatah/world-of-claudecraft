import { describe, it, expect } from 'vitest';
import { makeEmailToken, hashEmailToken } from '../server/email/tokens';
import { selectSender, ConsoleSender, HttpSender } from '../server/email/sender';

describe('email tokens', () => {
  it('mints a random token whose stored hash matches and never equals the secret', () => {
    const a = makeEmailToken();
    const b = makeEmailToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashEmailToken(a.token));
    expect(a.tokenHash).not.toBe(a.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('selectSender', () => {
  it('defaults to the console transport when email env is absent', () => {
    expect(selectSender({} as NodeJS.ProcessEnv)).toBeInstanceOf(ConsoleSender);
  });
  it('falls back to console when the provider config is only partial', () => {
    expect(selectSender({ EMAIL_API_URL: 'https://x' } as NodeJS.ProcessEnv)).toBeInstanceOf(ConsoleSender);
  });
  it('uses the http transport when url, key, and from are all set', () => {
    const s = selectSender({
      EMAIL_API_URL: 'https://x', EMAIL_API_KEY: 'k', EMAIL_FROM: 'no-reply@woc.test',
    } as NodeJS.ProcessEnv);
    expect(s).toBeInstanceOf(HttpSender);
  });
});
