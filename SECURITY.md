# Security

Report a vulnerability through GitHub's private vulnerability reporting on this repository
("Security" tab, "Report a vulnerability"). Please do not open a public issue for it.

In scope: any way for content in a fetched page or PDF, or an agent acting on it, to get past the
guard (`guard/guard.mjs`). That includes running code in the browser, reading the saved library
login or the guard's state, widening a batch without the user's approval, opening the logged-in
browser on an unapproved site without a prompt, or exceeding the page-load limits.

Known limits are listed under [What the guard does not cover](docs/safeguards.md#what-the-guard-does-not-cover).
They are not treated as vulnerabilities unless you find a way past them that the list does not
describe.
