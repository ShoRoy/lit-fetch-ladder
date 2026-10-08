"""The plugin's settings, as Claude Code saved them (pluginConfigs in its settings files).

When the tools run inside the Claude Code plugin, the contact email and the library proxy come
from there, so neither has to appear on a command line. Outside Claude Code there is nothing to
read, and the command-line options or the LFL_* environment variables are used instead.
"""
import json
import os

PLUGIN = "lit-fetch-ladder@"


def plugin_options(cwd=None, home=None):
    """The user's settings file, then the project's, then the project's local one, each
    overriding the one before (the order Claude Code reads them in)."""
    cwd = cwd or os.getcwd()
    home = home or os.path.expanduser("~")
    opts = {}
    for f in (os.path.join(home, ".claude", "settings.json"),
              os.path.join(cwd, ".claude", "settings.json"),
              os.path.join(cwd, ".claude", "settings.local.json")):
        try:
            with open(f) as fh:
                cfg = json.load(fh).get("pluginConfigs") or {}
        except (OSError, ValueError, AttributeError):
            continue
        for pid, v in cfg.items():
            if pid.startswith(PLUGIN) and isinstance(v, dict):
                opts.update(v.get("options") or {})
    return opts


def plugin_option(key):
    v = plugin_options().get(key)
    return v.strip() if isinstance(v, str) and v.strip() else None
