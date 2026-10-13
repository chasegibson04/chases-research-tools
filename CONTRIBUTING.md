# Contributing

Thanks for your interest. Tools here are small, tested, browser-only scientific utilities.

- **Bug in a tool?** Open an issue with the tool name, your exact inputs (or the example you used), expected vs actual result, and your browser/OS.
- **Want to add a tool?** Fork, run `npm run new-tool -- <slug> "<Name>"`, follow `docs/TOOL_IMPORT_GUIDE.md` and `docs/TESTING_PROTOCOL.md`, open a PR. CI must be green. Tools are published under MIT with you credited in the manifest `citation.authors` and `maintenance.maintainers`.
- **Using a tool in your own project?** Each `site/tools/<slug>/` folder is self-contained: `src/compute.ts` has no DOM dependencies and can be copied directly. Please keep the citation.
- Code of conduct: be kind, be precise, cite your sources.
