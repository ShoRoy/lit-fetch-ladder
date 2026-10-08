---
name: doctor
description: Check that lit-fetch-ladder is ready to fetch - Node, Python, the Playwright browser, settings, and whether a saved library login exists and how old it is (never its contents).
---

# Check the setup

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --data "${CLAUDE_PLUGIN_DATA}"
```

It reads the plugin's settings from Claude Code's settings files itself.

Report each line marked FIX together with its suggested fix. Settings are changed in `/plugin` under
lit-fetch-ladder's configuration. Do not read the saved login file; the doctor reports only whether it
exists and how old it is.
