import { getCollection, getEntry, render } from 'astro:content';
import categoriesData from '@/data/categories.json';
import type { ToolManifest } from './types';

export const CATEGORIES = categoriesData.categories;

export function getCategory(id: string) {
  return CATEGORIES.find((c) => c.id === id);
}
export function getSubcategory(catId: string, subId: string) {
  return getCategory(catId)?.subcategories.find((s) => s.id === subId);
}
export const toolUrl = (id: string) => `/tools/${id}/`;
export const categoryUrl = (c: string) => `/categories/${c}/`;
export const subcategoryUrl = (c: string, s: string) => `/categories/${c}/${s}/`;

export async function getAllTools(opts: { includeDrafts?: boolean } = {}) {
  const entries = await getCollection('tools');
  const tools = entries.map((e) => e.data as unknown as ToolManifest);
  const visible = tools.filter((t) => opts.includeDrafts || (t.status !== 'draft' || import.meta.env.DEV));
  return visible.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getToolDoc(id: string) {
  const entry = await getEntry('toolDocs', id);
  if (!entry) return null;
  const { Content, headings } = await render(entry);
  return { Content, headings };
}

/** Related-tool scoring: same subcategory 3, same category 1, each shared tag 1, explicit `related` 5. */
export function relatedTools(tool: ToolManifest, all: ToolManifest[], n = 4) {
  return all
    .filter((t) => t.id !== tool.id && t.status !== 'deprecated')
    .map((t) => {
      let score = 0;
      if (tool.related?.includes(t.id)) score += 5;
      if (t.category === tool.category) score += 1;
      score += 3 * t.subcategories.filter((s) => tool.subcategories.includes(s)).length;
      score += t.tags.filter((g) => tool.tags.includes(g)).length;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.t);
}
