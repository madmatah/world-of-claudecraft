// The dev-only chat interceptor chain (src/game/dev_chat_hooks.ts): the
// day/night scrub and the placer rig ride one hook main.ts calls on the
// chat send path. Vitest runs under Vite's dev env, so the DEV gate is
// open here; the cases pin recognition and pass-through, not the hooks'
// own behavior (each has its own suite).
import { describe, expect, it } from 'vitest';
import { tryDevChatHooks } from '../src/game/dev_chat_hooks';

function deps() {
  const logs: string[] = [];
  return {
    logs,
    bag: {
      hud: {
        log: (text: string) => {
          logs.push(text);
        },
        refreshDayNightDial: () => {},
      },
      renderer: {
        scene: { add() {}, remove() {}, traverse() {} } as never,
        worldCompileGate: () => undefined,
      },
      world: {
        player: undefined,
        chat: () => {},
        entities: new Map(),
        worldQuestLog: new Map(),
        worldQuestCycle: '',
      },
    },
  };
}

describe('dev chat hooks', () => {
  it('passes ordinary chat through untouched', () => {
    const d = deps();
    expect(tryDevChatHooks('hello world', d.bag)).toBe(false);
    expect(tryDevChatHooks('/party hi', d.bag)).toBe(false);
    expect(d.logs).toEqual([]);
  });

  it('consumes a day/night scrub line', () => {
    const d = deps();
    expect(tryDevChatHooks('/daynight', d.bag)).toBe(true);
    expect(d.logs.length).toBeGreaterThan(0);
    expect(d.logs[0]).toContain('/daynight');
  });
});

describe('dev chat hooks: Realm Racers circuit draft', () => {
  it('claims a draft race with no offline sim instead of sending it as chat', () => {
    const d = deps();
    const chat: string[] = [];
    const bag = {
      ...d.bag,
      world: { ...d.bag.world, chat: (text: string) => chat.push(text) },
      realmRacersDraft: { sim: null, draw: () => {} },
    };
    expect(tryDevChatHooks('/dev rallydraft my_track ace', bag)).toBe(true);
    expect(d.logs).toEqual([
      '[dev] Circuit drafts are offline only: the server never registers one.',
    ]);
    expect(chat).toEqual([]);
    // A caller that wires no draft deps at all gets the same claim.
    expect(tryDevChatHooks('/dev rallydraft my_track', d.bag)).toBe(true);
  });

  it('leaves a malformed draft id to the ordinary chat path', () => {
    const d = deps();
    expect(tryDevChatHooks('/dev rallydraft X', d.bag)).toBe(false);
    expect(d.logs).toEqual([]);
  });
});
