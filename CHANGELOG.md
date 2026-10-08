# Changelog

## 0.1.0

First release.

- Rungs 0-1 (`lfl discover`, `lfl fetch`): OpenAlex discovery and citation-chasing, Unpaywall/OpenAlex
  open-access download, a manifest with one recorded end state per request.
- Rungs 2-3: Microsoft's Playwright MCP server (`@playwright/mcp@0.0.78`) as two browsers, one without
  credentials and one carrying a saved library login (EZproxy hostname form, or none for an entitled
  network).
- Guard hook: denies code-execution, cookie, storage, raw-network and upload tools; asks before page
  interaction, and in the logged-in browser charges a click or key press that opens a page or a
  tab to the page budget (refunded when it opens nothing); requires a batch approval for the logged-in browser and again when the batch grows;
  asks before unapproved sites; per-paper budget, 20 loads per burst, 60 per 24 hours; protects the
  saved login and its own state; blocks proxied addresses outside the browser and the agent running
  the sign-in.
- Two settings: your email, and your library proxy. Paste a paper's address or the library's sign-in
  link and the plugin keeps the proxy's part; leave it empty on an entitled network (campus or VPN).
  The sign-in page is worked out from the proxy. The scripts read both settings themselves, so no
  command line carries the proxy.
- Both browsers identify as desktop Chrome of the bundled version, without "Headless".
- Login keeps only the proxy's cookies.
- The contact email goes only to OpenAlex and Unpaywall, in the parameter each asks for. Every other
  request (doi.org, open-access hosts) names the tool and nothing else.
- Batch approval names every site (registrable domain) the logged-in browser will open, with paper
  counts. Growth asks again: more papers, or a new site. A site reached by a redirect is not trusted
  until the user approves it.
- Approved sites are remembered as companions of the site the browser came from (for example a link
  site's content site) and allowed, listed in the prompt, in later batches that include that site.
  `/lit-fetch-ladder:sites` lists and forgets them.
