# Security

Report a vulnerability through GitHub's private vulnerability reporting on this repository
("Security" tab, "Report a vulnerability"). Please do not open a public issue for it.

In scope: any way for content in a fetched page or PDF, or an agent acting on it, to get past the
guard (`guard/guard.mjs`). That includes running code in the browser, reading the saved library
login or the guard's state, widening a batch without the user's approval, opening the logged-in
browser on an unapproved site without a prompt, or exceeding the page-load limits.

Known limits, stated in the README and not treated as vulnerabilities unless you find a way past
them that the README does not describe:

- The shell check on the saved login is a pattern match. A command that reconstructs the path to
  hide it can slip past it. The file tools (Read, Edit, Grep, Glob) are checked by resolved path.
- The shell check on the sign-in script is a pattern match too. A command that starts the sign-in
  another way, including a second Claude Code started from the shell, can slip past it. It cannot sign
  in for the user: that needs their password and second factor in a window on their screen. Users
  should sign in only to a window they opened with `/lit-fetch-ladder:login`.
- A redirect inside one page load cannot be stopped. The site it lands on is not trusted: the next
  navigation there asks the user.
- A page load is counted when the agent navigates, or when a click or key press in the logged-in
  browser opens a page or a tab. A page that loads another page by itself, with no navigation or
  click from the agent, is not counted.
- A site the user approves is remembered as a companion of the site the browser came from and is
  allowed in later batches that include that site (listed in their approval prompt). An approval given
  by mistake persists until forgotten with `/lit-fetch-ladder:sites`.
- Further papers from a publisher already in the batch are bounded by the page budget, not prevented.
- A tokenised download link on a site that is not proxied can only be refused by the skill's rule,
  not by the guard.
- If Node is missing the guard cannot run; the browsers need Node too and do not start.
