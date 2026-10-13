// Machine-readable site summary for AI crawlers/assistants (https://llmstxt.org). Regenerated each build.
import type { APIRoute } from 'astro';
import { SITE } from '@/config/site';
import { getAllTools, getCategory } from '@/lib/tools';
export const GET: APIRoute = async () => {
  const tools = await getAllTools();
  const lines = [
    `# ${SITE.name}`, '', `> ${SITE.description}`, '',
    'All tools run client-side in the browser (no uploads, no accounts, free, MIT-licensed). Each tool page includes usage docs, worked examples, and copy-ready citations.', '',
    '## Tools', '',
    ...tools.map((t) => `- [${t.name}](${SITE.url}/tools/${t.id}/): ${t.tagline} (${getCategory(t.category)?.name}; ${t.runtime.languages.join(', ')})`),
    '', '## Other pages', '', `- [All tools](${SITE.url}/tools/)`, `- [About](${SITE.url}/about/)`, `- [Source code](${SITE.repo})`, '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
