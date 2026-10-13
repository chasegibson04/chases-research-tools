import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// The JSON Schema in tools/tool.schema.json is the strict gate (scripts/validate-tools.mjs).
// This zod schema is intentionally permissive (passthrough) so the two never fight.
const tools = defineCollection({
  loader: glob({
    pattern: ['*/tool.json', '!_template/**'],
    base: './tools',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z
    .looseObject({
      id: z.string(),
      name: z.string(),
      tagline: z.string(),
      description: z.string(),
      version: z.string(),
      status: z.enum(['draft', 'beta', 'stable', 'deprecated']),
      kind: z.enum(['interactive', 'showcase']),
      category: z.string(),
      subcategories: z.array(z.string()).min(1),
      tags: z.array(z.string()).default([]),
    }),
});

const toolDocs = defineCollection({
  loader: glob({
    pattern: ['*/README.md', '!_template/**'],
    base: './tools',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.looseObject({}),
});

export const collections = { tools, toolDocs };
