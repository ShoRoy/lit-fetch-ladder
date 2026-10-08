---
name: sites
description: List or forget the companion sites lit-fetch-ladder remembers from earlier batch approvals (for example a publisher's content site that its link site redirects to).
disable-model-invocation: true
argument-hint: "[forget <site> | forget-all]"
---

# Remembered companion sites

When you approve a new site during a batch, the plugin remembers it as a companion of the site the
browser came from, for example a content site that a publisher's link site redirects to. In later
batches that include that site, the companion is allowed without asking and listed in the batch's
approval prompt. This skill lists them and forgets them; it cannot add one.

List:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sites.mjs" list --data "${CLAUDE_PLUGIN_DATA}"
```

Forget one site (it is removed both as a companion and as a site others follow), or all:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sites.mjs" forget <site> --data "${CLAUDE_PLUGIN_DATA}"
node "${CLAUDE_PLUGIN_ROOT}/scripts/sites.mjs" forget-all --data "${CLAUDE_PLUGIN_DATA}"
```

Show the user the list as printed. Forget only what the user names.
