// Single source of truth for site identity. Keep `url` in sync with site.meta.json
// (astro.config.mjs reads the JSON because it cannot import TS).
import meta from './site.meta.json';

export const SITE = {
  name: "Chase's Research Tools",
  shortName: 'CRT',
  url: meta.url,
  tagline: 'Free, browser-based scientific tools. No accounts, no uploads, nothing leaves your computer.',
  description:
    "Chase's Research Tools is a collection of free, open-source scientific calculators and analysis tools that run entirely in your browser.",
  locale: 'en-US',
  author: {
    name: 'Chase Gibson',
    affiliation: 'University of Wisconsin–Madison',
    orcid: '0009-0004-9871-8121',
    email: '', // public contact address (consider a dedicated alias)
    github: 'chasegibson04',
  },
  repo: 'https://github.com/chasegibson04/chases-research-tools',
  theme: 'paper' as 'graphite' | 'paper' | 'spectra',
  nav: [
    { label: 'Tools', href: '/tools/' },
    { label: 'Categories', href: '/categories/' },
    { label: 'About', href: '/about/' },
    { label: 'CV', href: '/cv/' },
    { label: 'Contact', href: '/contact/' },
  ],
  footerLinks: [
    { label: 'Privacy', href: '/privacy/' },
    { label: 'Terms', href: '/terms/' },
    { label: 'Cite this site', href: '/about/#cite' },
    { label: 'Source on GitHub', href: 'https://github.com/chasegibson04/chases-research-tools' },
  ],
  launchedYear: 2026,
} as const;
