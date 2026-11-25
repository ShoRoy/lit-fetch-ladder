---
name: sites
description: List or forget the sites lit-fetch-ladder remembers from your approvals, companion sites (for example a publisher's content site that its link site redirects to) and sites where clicks in the library browser run without asking.
disable-model-invocation: true
argument-hint: "[forget <site> | forget-all]"
---

# Remembered sites

The plugin remembers two kinds of site from your approvals:

- **Companion sites.** When you approve a site the library browser reached from another one, for
  example a content site that a publisher's link site redirects to, it is remembered as following that
  site. In later batches that include that site, the companion is allowed without asking and listed in
  the batch's approval prompt.
- **Click sites.** When you approve a click in the library browser on a site the batch approved, later
  clicks there run without asking, inside an approved batch, and still count as page loads. A click
  that starts more than one download, or an archive, stops the batch and removes its site from this
  list.

The list also shows what the plugin ships in `guard/known-sites.json`: known publisher redirects and
click sites. Those cannot be forgotten here. This skill lists and forgets; it cannot add a site.

List:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sites.mjs" list --data "${CLAUDE_PLUGIN_DATA}"
```

Forget one site (it is removed as a companion, as a site others follow, and as a click site), or all:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sites.mjs" forget <site> --data "${CLAUDE_PLUGIN_DATA}"
node "${CLAUDE_PLUGIN_ROOT}/scripts/sites.mjs" forget-all --data "${CLAUDE_PLUGIN_DATA}"
```

Show the user the list as printed. Forget only what the user names.
