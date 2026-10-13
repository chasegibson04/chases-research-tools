# SEO and discoverability (Google + AI assistants)

Traffic strategy: individual tool pages rank for specific long-tail queries ("peptide isotope distribution calculator") and get recommended by AI assistants. Navigation matters less than per-page quality.

## Implemented per tool page
- Unique `<title>` (`seo.title`), meta description, canonical URL, OpenGraph/Twitter tags, `robots noindex` for drafts.
- **JSON-LD**: `WebApplication`/`SoftwareApplication` (free, browser, version, author, keywords, license, dates, DOI), `BreadcrumbList`, and `FAQPage` when `seo.faq` is present (rich results).
- Full documentation in HTML (not behind JS), with H2 sections Google can quote: Overview, How to use, Method, Limitations, References.
- Related tools (internal linking) and category/subcategory pages (topical clusters).
- `sitemap-index.xml` (auto), `robots.txt`, `llms.txt` (auto-generated list of every tool for AI crawlers; the llms.txt convention is widely read by AI search tools).
- Fast: static HTML, zero JS on non-tool pages, tool JS < 60 KB before Run. Core Web Vitals pass by construction.

## To do after launch (checklist in ROADMAP)
1. Google Search Console: verify domain, submit sitemap, watch "Pages" for indexing issues.
2. Bing Webmaster Tools (feeds Copilot/ChatGPT search). Submit sitemap.
3. `og-default.png` exists (`npm run images`, uses the active theme). Per-tool OG images are planned (extend scripts/make-images.mjs).
4. Add 2–5 FAQ entries per tool: they're both rich-result bait and exactly what an AI assistant quotes.
5. Write each README "Method" section with real equations and constants: pages that teach rank and get cited.
6. Get a few authoritative backlinks: your lab website, your GitHub profile README, your ORCID "Works", a Zenodo DOI record, a Wikipedia external link where genuinely relevant, answers on ResearchGate/Biostars/StackExchange that link the tool when it answers the question.
7. Register tools in directories: bio.tools, SciCrunch RRID, Awesome lists on GitHub, the r-wasm/pyodide showcase lists.
8. Semantic HTML audit once a quarter; keep H1 unique; keep URLs stable forever (redirects if ever changed).

## AI-assistant discoverability specifically
Assistants recommend pages that (a) they can parse without JS, (b) state clearly what the tool does and its limits, (c) are citable, (d) appear in `llms.txt`, GitHub, and academic indexes. All four are built in. Keep `description` and `tagline` literal and keyword-rich.
