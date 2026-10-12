// Pruning the model store must never delete an official field model.
import { describe, expect, it } from 'vitest';
import { unusedModelKeys } from '../src/app/storage.ts';

describe('unusedModelKeys', () => {
  it('keeps official field models and models a saved robot uses', () => {
    const keys = ['field:override', 'asset-a', 'asm:asset-a', 'asset-b', 'asm:asset-b'];
    expect(unusedModelKeys(keys, new Set(['asset-a']))).toEqual(['asset-b', 'asm:asset-b']);
  });

  it('keeps a field model even when no robot is saved', () => {
    expect(unusedModelKeys(['field:override'], new Set())).toEqual([]);
  });
});
