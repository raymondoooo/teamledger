import { describe, expect, it } from 'vitest';
import { classifyEvent } from './sync.js';

describe('classifyEvent', () => {
  it('reads TeamSnap’s game titles', () => {
    expect(classifyEvent('vs Rivals SC')).toBe('game');
    expect(classifyEvent('@ Thunder United')).toBe('game');
    expect(classifyEvent('Game vs Riverside')).toBe('game');
  });

  it('reads practice and training titles', () => {
    expect(classifyEvent('Practice')).toBe('practice');
    expect(classifyEvent('Team Training')).toBe('practice');
    expect(classifyEvent('Goalie skills session')).toBe('practice');
  });

  it('picks tournament over game when a title says both', () => {
    // "Spring Cup — vs Rivals" is a tournament fixture; billing it as a plain
    // league game would apply the wrong ref-fee rule.
    expect(classifyEvent('Spring Cup — vs Rivals')).toBe('tournament');
    expect(classifyEvent('Spring Showcase')).toBe('tournament');
  });

  it('falls back to other rather than guessing', () => {
    expect(classifyEvent('Team photos')).toBe('other');
    expect(classifyEvent('Parent meeting')).toBe('other');
    // A stray "at" in a non-game title must not bill the team a ref fee.
    expect(classifyEvent('Team photos at the field')).toBe('other');
  });

  it('treats a leading "at" as an away game', () => {
    expect(classifyEvent('at Rivals SC')).toBe('game');
  });

  it('reads the description when the title is uninformative', () => {
    expect(classifyEvent('Riverside', 'Weekly practice at the dome')).toBe('practice');
  });
});
