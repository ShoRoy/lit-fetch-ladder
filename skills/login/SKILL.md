---
name: login
description: Sign in to your library for lit-fetch-ladder's library browser. Opens your library's sign-in page in a browser window. Only the user can run this; the agent cannot invoke it.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/login.mjs" *)
---

# Sign in to your library

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/login.mjs" --data "${CLAUDE_PLUGIN_DATA}" --background`

The line above, printed by the plugin, says what happened. Tell the user in two or three sentences:

- **OPENING**: a browser window is opening at their library's sign-in page. They sign in the way they
  normally do, open one paper through the library to check they can read it, and close the window.
  The login is saved when the window closes; `/lit-fetch-ladder:doctor` then shows its age. Only the
  proxy's own cookies are kept, and the file is readable only by them.
- **ALREADY OPEN**: a sign-in window is already open; they finish signing in there.
- **NOT OPENED**, or no status line: pass on the reason, then show them this command to run in their
  own terminal. It opens the same window and waits until they close it:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/login.mjs" --data "${CLAUDE_PLUGIN_DATA}"
  ```

  Without a display (an SSH session, a plain Docker container, a headless server), point them to
  "Signing in from a container" in the README.

If the window shows an error instead of the library's sign-in, they go to their library's website in
that window, sign in there, open a paper through it and close the window. A library whose sign-in page
lives elsewhere can be given it with `--login-url <address>` on the terminal command.

Do not run any command yourself. A sign-in is started by the user, never by the agent.
