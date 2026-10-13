# Monetization: ads, donations, consent, and realistic revenue

Everything is config-driven in `site/src/config/monetization.ts`; components are `AdSlot.astro`, `AdScripts.astro`, `DonateButton.astro`. Empty IDs render nothing in production (a dashed placeholder in dev).

## Default configuration (chosen 2026-10-13)
Ads: **Google AdSense**, manual placements only (no Auto ads). Donations: **Ko-fi** primary, GitHub Sponsors secondary link. Alternatives wired and switchable: **EthicalAds** (`ads.provider = 'ethicalads'`), **GitHub Sponsors** primary (`donate.primary = 'github'`).

## Placement policy (non-invasive by design)
- Slots: `toolBelow` (horizontal, directly under the tool frame, above docs), `directorySidebar` (rectangle on the directory page), `footer` (reserved, unused).
- Never inside the tool frame, never sticky/overlay/interstitial, never on CV/contact/legal pages, never more than one ad per viewport.
- Fixed `min-height` so ads never shift layout (CLS = 0). "Advertisement" label above each slot.
- Tools can opt out with `ads.allow: false` (e.g., when cross-origin isolation is enabled).

## Setup steps
### AdSense
1. Site must be live on its own domain with real content (≥ ~10 polished tools, About, Contact, Privacy, Terms). Apply at adsense.google.com; review takes days to weeks. Common rejection: "low value content" → add more tools/docs.
2. Paste `ca-pub-…` into `adsense.client`; create one **display ad unit per slot** in the dashboard and paste their numeric ids into `adsense.slots`.
3. Enable **Privacy & messaging → GDPR message** in AdSense (Google's certified CMP, free). Required for EEA/UK/Switzerland traffic since Jan 2024. Then set `consent.enabled = true` (the message is injected by the AdSense script itself).
4. `ads.txt`: AdSense gives a line like `google.com, pub-XXXX, DIRECT, f08c47fec0942fa0`; put it in `site/public/ads.txt`.
5. Update the privacy policy page (already drafted with the required Google cookie disclosure).
### EthicalAds
Apply at ethicalads.io/publishers (they favour developer/science audiences; approval usually needs an established site). Set `ethicalads.publisher`. No cookies, no CMP needed.
### Ko-fi / GitHub Sponsors
Create accounts; set usernames. Ko-fi: 0 % platform fee on donations; GitHub Sponsors: 0 % fee, needs a Sponsors profile approval.

## Revenue reality check
RPM (revenue per 1,000 pageviews) for niche science/education tools with mostly US/EU academic traffic is typically **$3–15** on AdSense (higher-intent tools and US traffic push toward the top; EthicalAds is usually $2–4 and only pays once you have real volume).

| Monthly pageviews | AdSense @ $5 RPM | @ $12 RPM |
|---|---|---|
| 5,000 | $25 | $60 |
| 20,000 | $100 | $240 |
| 50,000 | $250 | $600 |
| 200,000 | $1,000 | $2,400 |

AdSense pays out at $100. Realistic path: 15–30 well-targeted tools → a few thousand monthly views within 6–12 months → coffee money; meaningful income needs ~50k+ views, which means dozens of tools ranking for queries people actually search. Donations from scientists are rare but non-zero; a DOI and clear "support" line help.

## Legal/compliance checklist
Privacy policy (done, update when enabling ads), Terms (done), consent for EEA/UK (Google CMP), `ads.txt`, no ads on pages that could be mistaken for official university content, don't click your own ads, and tell the owner's institution if required by employment policy.
