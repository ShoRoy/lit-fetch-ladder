<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ShoRoy/lit-fetch-ladder/main/docs/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/ShoRoy/lit-fetch-ladder/main/docs/assets/logo-light.svg" width="96" height="96" alt="lit-fetch-ladder logo: a ladder">
  </picture>
</p>

<h1 align="center">lit-fetch-ladder</h1>

<p align="center">
  <b>Literature surveys in Claude Code, open access first.</b><br>
  Find papers, fetch each one at the lowest rung that works, up to your own library login, and file them into Zotero, so that a RAG over your library works from the full texts, not only the abstracts.
</p>

<p align="center">
  <a href="#quick-start">Install</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="docs/safeguards.md">Safeguards</a> ·
  <a href="docs/zotero.md">Zotero</a> ·
  <a href="https://levelup.gitconnected.com/the-last-rung-of-an-agent-run-literature-survey-institutional-login-safeguards-and-plugin-3839ee41aaf9">Article</a>
</p>

<p align="center">
  <a href="https://github.com/ShoRoy/lit-fetch-ladder/releases"><img src="https://img.shields.io/badge/version-0.2.5-b45309" alt="Version 0.2.5"></a>
  <a href="https://github.com/ShoRoy/lit-fetch-ladder/actions/workflows/tests.yml"><img src="https://github.com/ShoRoy/lit-fetch-ladder/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-d97757" alt="Claude Code plugin">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ShoRoy/lit-fetch-ladder?color=555" alt="MIT license"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ShoRoy/lit-fetch-ladder/main/docs/assets/pipeline-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/ShoRoy/lit-fetch-ladder/main/docs/assets/pipeline-light.svg">
    <img src="https://raw.githubusercontent.com/ShoRoy/lit-fetch-ladder/main/docs/assets/pipeline-light.svg" width="900" alt="How lit-fetch-ladder works. A request (a topic, DOIs or a paper's references) climbs four rungs: find and rank papers, an open-access copy, a browser without a login, a browser with your library login. Claude Code hooks guard the last rung. Every file is checked against its paper, recorded in a manifest, and can be filed into Zotero through Zotero MCP, a separate project the plugin can install.">
  </picture>
</p>

**lit-fetch-ladder** is a Claude Code plugin for the fetching side of a literature survey. Ask for a
topic, a list of DOIs or a paper's references.

- **Finds** and ranks the papers through OpenAlex (rung 0).
- **Fetches** open access first, through Unpaywall and OpenAlex (rung 1), then opens pages a script
  cannot read in a browser without a login (rung 2), and uses the library browser, with your library
  login, only for what is left (rung 3).
- **Checks** every file against its paper's title and first author, so a mislabelled copy is not taken
  for the paper.
- **Records** every outcome in a manifest (`OA_FETCHED`, `PROXY_FETCHED`, `NEEDS_AUTH`,
  `ABSTRACT_ONLY`, ...), so a survey can say what it missed.

Rungs 2 and 3 use [Microsoft's Playwright MCP server](https://github.com/microsoft/playwright-mcp),
pinned to `@playwright/mcp@0.0.78`, and this plugin adds the configuration, the batch driver and the
guard around it. Rungs 0 and 1 also run [without Claude Code](docs/usage.md#without-claude-code).

## A guard against prompt injection

Any page the agent reads can carry instructions planted for it, and here the agent reads pages while it
controls a browser signed in as you. The fetch skill tells the agent to treat fetched text as data. A
guard written as Claude Code hooks checks each tool call before it runs, and limits what the agent can do
if it follows a planted line anyway.

- The library browser opens only the papers of a batch you approved, on the sites its approval prompt
  lists, within a page budget and a per-burst and daily cap.
- Neither browser can run code, read cookies or storage, or read a request's raw headers.
- The agent's file tools cannot read the saved login, and shell commands that name it or take the
  plugin's data folder as a whole are refused.
- A page load or click that starts a bulk download stops the batch.
- Changes to your Zotero library beyond filing ask you first.

A red-team replay in `tests/redteam/` feeds the guard what an agent might try after reading a page with
planted instructions and checks each decision, on every push to main and every pull request. The guard
enforces rules but is not a sandbox. The baseline defence against prompt injection is expected to come
from the vendor, in Claude Code's permission prompts and the model's own resistance to planted
instructions, and the guard adds limits on top of it. The plugin is meant for academic research, not for
fetching items you know are restricted. [Safeguards](docs/safeguards.md) says what the guard covers and
what it does not.

## <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/54yyyu/zotero-mcp/v0.17.3/docs/assets/logo-dark.svg"><img src="https://raw.githubusercontent.com/54yyyu/zotero-mcp/v0.17.3/docs/assets/logo-light.svg" width="26" height="26" alt="Zotero MCP logo"></picture> Works with Zotero MCP

[Zotero MCP](https://github.com/54yyyu/zotero-mcp) is a separate project that puts your Zotero library
in any AI agent, to search, read, cite and annotate. lit-fetch-ladder files a finished batch through
`zotero-cli`, which ships with Zotero MCP, and its part ends there. `/lit-fetch-ladder:zotero setup`
installs Zotero MCP and connects it to your folder, so fetching, filing and working with your library run
as one pipeline. Without Zotero MCP the plugin fetches as usual. See [Filing into Zotero](docs/zotero.md).

## Quick start

**Before you install**, have these on the machine where Claude Code runs. Tested on Linux.

| Needed | For |
|---|---|
| Claude Code 2.1.271 or later | the plugin |
| Node 18 or later with npx, installed before the plugin (Ubuntu 22.04's own is too old) | the guard and the browsers |
| Python 3.9 or later | the fetch tools |
| poppler-utils | checking and reading PDFs; without it nothing is filed |
| root once, on a server, WSL or Docker | the browser's system libraries (step 3) |

**1. Install.** Start Claude Code in the folder you use for literature surveys and run

```
/plugin marketplace add ShoRoy/lit-fetch-ladder
/plugin install lit-fetch-ladder@fetch-ladder
```

When asked where to install, choose the scope that suits you:

- **Install for you (user scope)** loads the plugin and its guard in every folder you open Claude Code in.
- **Install for you, in this repo only (local scope)** loads them only in this folder (in VS Code,
  **Install locally**).

Wherever it loads, the guard checks every file, shell and web tool call
([what that costs](docs/safeguards.md#what-the-guard-costs)). From a shell:
`claude plugin install lit-fetch-ladder@fetch-ladder --scope user` (or `local`).

**2. Enter the two settings** Claude Code asks for (after an install from a shell, run
`/plugin configure lit-fetch-ladder@fetch-ladder`). Your email is required by Unpaywall. For the library
proxy, paste the address of any paper opened through your library's website, or leave it empty on a
campus network or library VPN.

**3. Install the browser** once, in a terminal.

```
npx -y -p @playwright/mcp@0.0.78 playwright install chromium
```

On a server, WSL or Docker, also run `npx -y -p @playwright/mcp@0.0.78 playwright install-deps chromium`
once, as root ([if the browsers do not start](docs/usage.md#if-the-browsers-do-not-start)).

Then run `/lit-fetch-ladder:doctor` in Claude Code to check the setup. Third-party marketplaces do not
update by default, and the guard is security code, so turn on auto-update for this marketplace in
`/plugin` or update after each release ([CHANGELOG.md](CHANGELOG.md)).

**4. Fetch.**

```
/lit-fetch-ladder:fetch survey graph neural networks for molecular property prediction, top 10 since 2020
/lit-fetch-ladder:fetch 10.1038/nature14539 10.48550/arXiv.1706.03762
/lit-fetch-ladder:fetch the references of 10.1038/nature14539
```

**5. Sign in to your library** if you set a proxy. When papers in a batch need your library and there is
no login saved in the last 12 hours, the fetch asks you once to run `/lit-fetch-ladder:login`. Only you
can run it.
Sign in to the window it opens; only the proxy's cookies and site storage are saved. See
[Signing in](docs/sign-in.md).

**6. Add Zotero** (optional). Run `/lit-fetch-ladder:zotero setup` once. After a fetch, run
`/lit-fetch-ladder:zotero <batch>` or ask the agent to file the batch. See
[Filing into Zotero](docs/zotero.md).

## Use it responsibly

Publishers watch for systematic downloading through library proxies, and the usual response is to
suspend the library's access for everyone at the institution, not only for the person who caused it.
So the plugin goes open access first, asks you to approve each library batch, and caps the library
browser's page loads (5 per paper, 20 per burst, 60 per 24 hours). Use it for your own
research, on papers you name, with access your library already gives you. If you raise the limits or
remove a safeguard, the consequences for you and your library are yours.

## Documentation

| Guide | What's in it |
|---|---|
| [Signing in](docs/sign-in.md) | The library login, what is saved, containers and remote machines, when the window does not open |
| [Fetching papers](docs/usage.md) | The rungs, what comes back, approving a library batch, PDFs in a viewer, papers that do not come back, use without Claude Code |
| [Filing into Zotero](docs/zotero.md) | Setting up Zotero MCP, filing a batch and undoing it, what the guard asks about |
| [Safeguards](docs/safeguards.md) | What the guard enforces and costs, what it does not cover, the page-load limits, what is sent where |

Background: [The last rung of an agent-orchestrated literature survey](https://levelup.gitconnected.com/the-last-rung-of-an-agent-run-literature-survey-institutional-login-safeguards-and-plugin-3839ee41aaf9),
the article behind the plugin, with the runs and the threat model. Changes: [CHANGELOG.md](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. The security-sensitive parts (the guard, the browsers and the
sign-in, and the paths [CONTRIBUTING.md](CONTRIBUTING.md) lists) change only through the author, so for
those open an issue instead; ideas that harden the design are especially welcome there. Report a way past
the guard privately, as described in [SECURITY.md](SECURITY.md).

## License

MIT ([LICENSE](LICENSE)).
