---
name: login
description: Save or renew the library login used by lit-fetch-ladder's library browser. Shows the user the command to run in their own terminal; the agent never runs it.
disable-model-invocation: true
---

# Save your library login

The library browser carries a saved login, which you create yourself. The agent never runs this step
and never sees your password or second factor. The plugin blocks the agent from running it.

If you left "Library proxy" empty because publishers already recognise your network (a campus network
or a library VPN), no login is needed. Your setting: "${user_config.proxy_suffix}"

Otherwise, run this in your own terminal:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/login.mjs" --data "${CLAUDE_PLUGIN_DATA}"
```

1. A browser window opens at your library's sign-in page, worked out from your proxy setting. Sign in
   the way you normally do.
2. Open one paper through your library to check you can read it.
3. Close the window. Only the proxy's own cookies are saved; your sign-in provider's cookies are
   dropped, so the file cannot sign the browser in anywhere else. The file is readable only by you.

If the window shows an error instead of your library's sign-in, go to your library's website in that
window, sign in there and open a paper through it, then close the window. A library whose sign-in page
lives somewhere else can be given it with `--login-url <address>`.

Library sessions usually last a few hours. Run this again when fetches start landing on the sign-in
page.

**No window appears?** The sign-in needs a display. In a VS Code dev container on Windows (WSLg) or
Linux, display forwarding is usually already set up. In a plain Docker container, an SSH session or
a headless server, see "Signing in from a container" in the README, or run the command on your own
machine and copy the saved file across.

When reporting back to the user, show them the command above with the values filled in and these
steps. Do not run the command.
