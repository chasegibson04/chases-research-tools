import { describe, it, expect } from 'vitest';
import run from '../src/compute';
import basic from '../examples/basic.json';

const ctx = { progress: () => {}, log: () => {}, signal: new AbortController().signal };

describe('__SLUG__ compute', () => {
  it('reproduces the golden example', async () => {
    const out = await run(basic.input as any, ctx);
    expect(out.value).toBe(basic.expected.value);
  });
  it('rejects invalid input', async () => {
    await expect(run({ exampleParam: 'x' } as any, ctx)).rejects.toThrow();
  });
});
