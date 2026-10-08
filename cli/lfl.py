#!/usr/bin/env python3
"""Run the lit-fetch-ladder tools from a checkout, without installing: python3 cli/lfl.py <command> ..."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from lit_fetch_ladder.cli import main  # noqa: E402

sys.exit(main())
