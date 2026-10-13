// Pure compute. Runs inside a Web Worker; must not touch the DOM. Keep it deterministic so golden tests are stable.
import type { ComputeFn } from '@/lib/types';

export interface Input { exampleParam: number }
export interface Output { value: number }

const run: ComputeFn<Input, Output> = async (input, ctx) => {
  ctx.progress(0, 'Starting');
  if (typeof input.exampleParam !== 'number') throw new Error('exampleParam must be a number');
  const value = input.exampleParam * 2;
  ctx.progress(1, 'Done');
  return { value };
};
export default run;
