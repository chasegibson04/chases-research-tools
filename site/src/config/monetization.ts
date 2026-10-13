// All monetization is config-driven and swappable. Empty IDs => component renders nothing
// (a dashed placeholder appears only in `astro dev`). See docs/MONETIZATION.md.
export const MONETIZATION = {
  ads: {
    // 'adsense' | 'ethicalads' | 'none'
    provider: 'adsense' as 'adsense' | 'ethicalads' | 'none',
    adsense: {
      client: '', // ca-pub-XXXXXXXXXXXXXXXX (public; safe to commit)
      slots: {
        toolBelow: '', // numeric slot id for the slot below a tool's results
        directorySidebar: '',
        footer: '',
      },
      autoAds: false, // keep false: auto ads are what makes sites look terrible
    },
    ethicalads: {
      publisher: '', // your EthicalAds publisher id
      keywords: ['science', 'research', 'data-analysis'],
    },
    // Pages/areas where ads are never shown regardless of provider
    neverOn: ['/cv/', '/contact/', '/privacy/', '/terms/', '/404'],
  },
  donate: {
    primary: 'kofi' as 'kofi' | 'github' | 'none',
    kofi: { username: '' }, // https://ko-fi.com/<username>
    githubSponsors: { username: '' }, // https://github.com/sponsors/<username>
    label: 'Buy me a coffee',
  },
  consent: {
    // Google's own "Privacy & messaging" CMP in AdSense is certified and free. Set true once configured.
    enabled: false,
  },
} as const;
