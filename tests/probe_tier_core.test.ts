import { describe, expect, it } from 'vitest';
import { presetFromSettingsJson, tierFromPreset } from '../src/probe/probe_tier_core';

describe('tierFromPreset', () => {
  it('maps the numbered presets, advanced and unknown to ultra, insane by name', () => {
    expect(tierFromPreset(1)).toBe('low');
    expect(tierFromPreset(2)).toBe('medium');
    expect(tierFromPreset(3)).toBe('high');
    expect(tierFromPreset(4)).toBe('ultra');
    expect(tierFromPreset(5)).toBe('ultra');
    expect(tierFromPreset(6)).toBe('insane');
    expect(tierFromPreset(undefined)).toBe('ultra');
    expect(tierFromPreset(42)).toBe('ultra');
  });
});

describe('presetFromSettingsJson', () => {
  it('reads the graphics preset number out of the settings blob and nothing else', () => {
    expect(presetFromSettingsJson('{"graphicsPreset":3}')).toBe(3);
    expect(presetFromSettingsJson('{"graphicsPreset":"3"}')).toBeUndefined();
    expect(presetFromSettingsJson('{}')).toBeUndefined();
    expect(presetFromSettingsJson('nope')).toBeUndefined();
    expect(presetFromSettingsJson(null)).toBeUndefined();
    expect(presetFromSettingsJson('[1]')).toBeUndefined();
  });
});
