# Prompt cookbook (what to paste into Claude Code for common jobs)

Every prompt assumes the agent reads `AGENTS.md` first; say so if a model seems to skip it.

## Import a tool from another project
> Hi! I have a module named roughly **X** at **/path/to/project** (or: in the Claude project "Y"). Please follow the README and AGENTS instructions to import this to the site, test, and push when ready.

Add if relevant: "It is written in Python and depends on numpy/scipy" · "Keep it in R (needs package Z)" · "Put it under mass-spectrometry / peptidomics" · "Publish as beta" · "Open a PR instead of pushing to main".

## Add a project that cannot run in the browser
> I have a desktop/GPU/package project at **/path** with a GitHub release at **URL**. Add it as a showcase tool per docs/SHOWCASE_PROJECTS.md with figures and captions from **/path/figures**, then test and push.

## Update the CV
> Here is my CV as **cv.docx** and a headshot **photo.jpg**. Update the CV page per docs/CV_PAGE_GUIDE.md. Touch nothing else.

## Change the theme / design
> Switch the site theme to **paper** and self-host the fonts per docs/DESIGN_SYSTEM.md. Show me before/after screenshots of a tool page and the home page.

## Fix a reported bug in a tool
> Issue #N reports that **tool** gives **wrong value** for **input**. Reproduce with a failing unit test first, fix `src/compute.ts`, bump the version per docs/TESTING_PROTOCOL.md "Regression rule", update CHANGELOG.md, test, push.

## Enable ads / donations
> AdSense approved: client **ca-pub-…**, slot ids **…**. Ko-fi username **…**. Configure per docs/MONETIZATION.md, add ads.txt, enable the consent message, verify the privacy page, build, push.

## Deploy / domain
> I bought **domain.tld** on Cloudflare. Follow docs/DEPLOYMENT.md to point the Worker at it, update every URL (site.meta.json, robots.txt, CITATION.cff, CHANGEME), rebuild, push.

## Routine maintenance
> Do the monthly maintenance in docs/ADMIN.md: update dependencies, run the full test protocol, report anything that broke.

## Add a category
> Add subcategory **"Glycomics"** under **mass-spectrometry** per docs/CATEGORIES.md.
