// Builds citation strings in common formats for a tool. (docs/CITATIONS.md)
import type { ToolManifest } from './types';

export interface CiteSource { siteName: string; siteUrl: string; accessed?: Date }

const fmtAuthorsAPA = (a: ToolManifest['citation']['authors']) =>
  a.map((x) => `${x.family}, ${x.given.split(/\s+/).map((g) => g[0] + '.').join(' ')}`).join(', ');
const fmtAuthorsMLA = (a: ToolManifest['citation']['authors']) =>
  a.length === 1 ? `${a[0].family}, ${a[0].given}` : `${a[0].family}, ${a[0].given}, et al.`;
const fmtAuthorsFull = (a: ToolManifest['citation']['authors']) => a.map((x) => `${x.given} ${x.family}`).join(', ');
const fmtAuthorsVancouver = (a: ToolManifest['citation']['authors']) =>
  a.map((x) => `${x.family} ${x.given.split(/\s+/).map((g) => g[0]).join('')}`).join(', ');

export function buildCitations(tool: ToolManifest, src: CiteSource) {
  const c = tool.citation;
  const url = `${src.siteUrl.replace(/\/$/, '')}/tools/${tool.id}/`;
  const accessed = src.accessed ?? new Date();
  const acc = accessed.toISOString().slice(0, 10);
  const ver = c.version ?? tool.version;
  const doi = c.doi ? ` https://doi.org/${c.doi}` : '';
  const key = `${c.authors[0]?.family.toLowerCase() ?? 'tool'}${c.year}${tool.id.replace(/[^a-z0-9]/gi, '')}`;
  return {
    apa: `${fmtAuthorsAPA(c.authors)} (${c.year}). ${c.title} (Version ${ver}) [Computer software]. ${src.siteName}. ${url}${doi}`,
    mla: `${fmtAuthorsMLA(c.authors)}. ${c.title}. Version ${ver}, ${src.siteName}, ${c.year}, ${url}. Accessed ${acc}.`,
    chicago: `${fmtAuthorsFull(c.authors)}. ${c.year}. "${c.title}." Version ${ver}. ${src.siteName}. ${url}.`,
    vancouver: `${fmtAuthorsVancouver(c.authors)}. ${c.title} [Internet]. Version ${ver}. ${src.siteName}; ${c.year} [cited ${acc}]. Available from: ${url}`,
    bibtex: `@software{${key},\n  author = {${c.authors.map((x) => `${x.family}, ${x.given}`).join(' and ')}},\n  title = {${c.title}},\n  year = {${c.year}},\n  version = {${ver}},\n  publisher = {${src.siteName}},\n  url = {${url}}${c.doi ? `,\n  doi = {${c.doi}}` : ''}\n}`,
    ris: `TY  - COMP\n${c.authors.map((x) => `AU  - ${x.family}, ${x.given}`).join('\n')}\nTI  - ${c.title}\nPY  - ${c.year}\nET  - ${ver}\nPB  - ${src.siteName}\nUR  - ${url}${c.doi ? `\nDO  - ${c.doi}` : ''}\nY2  - ${acc}\nER  - `,
  };
}

export const CITATION_FORMATS = [
  { id: 'apa', label: 'APA 7' },
  { id: 'mla', label: 'MLA 9' },
  { id: 'chicago', label: 'Chicago' },
  { id: 'vancouver', label: 'Vancouver' },
  { id: 'bibtex', label: 'BibTeX' },
  { id: 'ris', label: 'RIS (EndNote/Zotero)' },
] as const;
