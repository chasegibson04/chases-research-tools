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
    orcid: '', // e.g. 0000-0000-0000-0000
    email: '', // public contact address (consider a dedicated alias)
    github: 'CHANGEME',
  },
  repo: 'https://github.com/CHANGEME/chases-research-tools',
  theme: 'graphite' as 'graphite' | 'paper' | 'spectra',
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
    { label: 'Source on GitHub', href: 'https://github.com/CHANGEME/chases-research-tools' },
  ],
  launchedYear: 2026,
} as const;
