# Signing in to your library

Only rung 3 needs this, for papers that neither an open-access copy nor the browser without a login can
reach. On a campus network or library VPN that publishers already recognise, no sign-in is needed.

## Sign in

```
/lit-fetch-ladder:login
```

Only you can run this command. The agent is not allowed to invoke it. A browser window opens at your
library's sign-in page, which the plugin works out from your proxy setting. Sign in as you normally do,
open one paper to check access, and close the window. The login is saved when the window closes, and
`/lit-fetch-ladder:doctor` shows its age.

If the window cannot open, for example with no display or with a policy that turns off commands in
skills, the command shows a line to run in your own terminal instead, which opens the same window and
waits. Only ever sign in to a window you opened yourself.

If the window shows an error instead of the sign-in page, go to your library's website in that window,
sign in, open a paper through it and close the window. A library whose sign-in page lives elsewhere can
be given it with `--login-url <address>`.

## What is saved

Only the proxy's own cookies are saved. The sign-in provider's cookies (single sign-on, second factor)
are dropped, so the saved file cannot sign the browser in anywhere except the proxy. The file lives in
the plugin's data directory, which the doctor prints as `plugin data:`, and only you can read it.
Library sessions usually last a few hours. When fetches land on the sign-in page, run the login again,
and the agent resumes the same paper.

Uninstalling, from the Installed tab of `/plugin` or with `claude plugin uninstall
lit-fetch-ladder@fetch-ladder`, removes the plugin's data directory with the saved login. The shell form
takes `--keep-data` to keep it. Fetched papers stay in your project's `lit-fetch-runs/`.

## Signing in from a container

The sign-in window needs a display. Check with `echo $DISPLAY $WAYLAND_DISPLAY`. If neither is set, the
window cannot open, and a variable that is set does not prove the display works (see
[If the window does not open](#if-the-window-does-not-open)).

- **VS Code Dev Containers** can forward the host display into the container. On Windows with WSL2 this
  needed no configuration.
- **Plain Docker on a Linux desktop.** Run the container with
  `-e DISPLAY -v /tmp/.X11-unix:/tmp/.X11-unix` and allow local clients on the host with `xhost +local:`.
  Undo it with `xhost -local:`, since it lets any local process draw on your display.
- **Docker on Windows with WSL2.** Add `-v /tmp/.X11-unix:/tmp/.X11-unix -v /mnt/wslg:/mnt/wslg
  -e DISPLAY -e WAYLAND_DISPLAY -e XDG_RUNTIME_DIR` to `docker run`.
- **SSH or a headless server.** On a machine with a display, Node and the Playwright browser, run
  `node scripts/login.mjs --data /tmp/lfl-login --proxy-suffix <your library proxy>` from a clone of this
  repository, since that machine has no plugin settings to read. Copy
  `/tmp/lfl-login/secret/library-state.json` to `secret/library-state.json` under the plugin's data
  directory on the server, `chmod 600` it, and delete `/tmp/lfl-login`.

### If the window does not open

`/lit-fetch-ladder:login` reports the window as opening before the browser has started, so it says this
even when the browser exits at once. If no window appears, or the doctor still shows the old login, read
`login.log` in the plugin's data directory.

If the log says "Missing X server or $DISPLAY", the browser found no X display it can use. In a
container, `DISPLAY` can be set while nothing answers on it. This was seen with VS Code's forwarding on
Windows, where the forwarded Wayland display worked and the X display did not. Run the terminal command
that `/lit-fetch-ladder:login` shows with `XDG_SESSION_TYPE=wayland` in front, so the browser uses
Wayland:

```
XDG_SESSION_TYPE=wayland node "<plugin root>/scripts/login.mjs" --data "<plugin data directory>"
```
