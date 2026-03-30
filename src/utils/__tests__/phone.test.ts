import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../utils/phone.js';

describe('normalizePhone', () => {
  it('normalizes US number with parens to E.164', () => {
    expect(normalizePhone('(213) 555-1234')).toBe('+12135551234');
  });

  it('normalizes international number to E.164', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('normalizes US number without country code', () => {
    expect(normalizePhone('2135551234')).toBe('+12135551234');
  });

  it('throws for invalid phone number string', () => {
    expect(() => normalizePhone('not-a-number')).toThrow('Invalid phone number');
  });

  it('throws for empty string', () => {
    expect(() => normalizePhone('')).toThrow('Invalid phone number');
  });
});
