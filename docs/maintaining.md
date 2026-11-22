# How we handle your contribution

Plainphone is a small project. This page explains what happens after you open
an issue, a pull request or a discussion.

## Issues or Discussions

- **Issues** are for bugs and concrete tasks: something that does not work as
  described, or a change that is clear enough to start on.
- **[Discussions](https://github.com/plainphone/plainphone/discussions)** are
  for everything else. Ask in **Q&A** if you need help with setup or want to
  know how something works. Post in **Ideas** if a change needs to be talked
  through first. **Announcements** is where the maintainers post news.

A question opened as an issue may be moved to Discussions. An idea in
Discussions becomes an issue once it is concrete and fits the
[design principles](design-principles.md).

## Security problems go private

A way around the lock, or a way to read someone else's data, is a security
bug. Never report it in a public issue, pull request or discussion. Use
**Security → Report a vulnerability** as described in
[SECURITY.md](../SECURITY.md). If you post one publicly by mistake, we will
hide it and continue in private.

## Triage

The maintainers read every new issue, usually within a few days. It can take
longer, and there is no guaranteed response time.

New issues from outside the maintainer team get the `needs-triage` label
automatically. After the maintainers look at an issue, they replace the label
with one or more of these:

| Label | Meaning |
|---|---|
| `bug` | Something does not work as described. |
| `enhancement` | A change to how Plainphone works. |
| `documentation` | Docs, README or website text. |
| `accessibility` | A barrier for people with disabilities. |
| `test-report` | Results from trying Plainphone on a phone or an emulator. |
| `translation` | A wrong, awkward or missing text in one of the five languages. |
| `question` | Needs more information or a decision. |
| `good first issue` | Small and well defined, good for a first contribution. |
| `help wanted` | Help from outside the core team is welcome. |
| `blocked` | Waiting on something else before work can continue. |
| `external` | Pull request from someone outside the maintainer team. |
| `awaiting-maintainer` | Reviewed and waiting for the maintainers to decide. |
| `duplicate` | Already covered by another issue or pull request. |
| `wontfix` | Will not be done, with a reason in the thread. |
| `invalid` | Not a Plainphone issue, or cannot be reproduced. |

## Replies from the project bot

Some replies come from the project bot (`github-actions[bot]`), signed "the
Plainphone bot". It confirms that an issue or pull request has arrived, and it
also posts technical answers and review notes that the maintainers have asked it
to send. Decisions to merge, close as `wontfix` or change the plan are always
made by the maintainers.

## How a pull request from outside is reviewed

1. **CI.** GitHub may require the maintainers to approve workflow runs on
   pull requests from forks. The repository’s Actions settings determine
   which contributors need approval.
2. **Automated review.** The change usually gets an automated review against
   the code, the [design principles](design-principles.md) and the
   [evidence review](evidence.md). You may get comments to address.
3. **The maintainers decide.** When CI is green and the review has no open
   blocking findings, the pull request is usually labelled `awaiting-maintainer`.
   The maintainers then merge it, ask for changes or explain why it will not
   be merged. Pull requests from outside are never merged automatically.

For a larger change, open an issue first so the approach is agreed before you
spend time on code.

## Evidence for new features

Every user-facing feature states its evidence on the `Evidence:` line of the
pull request (and in the evidence field of a feature idea). Cite a study,
review or official recommendation and say how it applies. If there is none,
write `no direct evidence, reason: …` and explain the design choice and its
uncertainty. A feature that works against the design principles, such as
hidden monitoring, streaks or engagement features, will not be added however
well it is built.

## When issues are closed

- Bugs are never closed automatically for being old. They stay open until
  they are fixed or the maintainers explain why they are closing them.
- An issue or Q&A question that is waiting for information from you
  may be closed after 30 days without an answer. You can reopen it, or open a new
  one, when you have the details.
- Duplicates are closed with a link to the original.
- `wontfix` is closed with a reason in the thread.

## Licence of contributions

There is no contributor licence agreement and no sign-off requirement. By
submitting a contribution you agree it is licensed under Apache-2.0
(section 5 of the [licence](../LICENSE)).

## For maintainers

**Before sharing the repository widely,** go through the
[public alpha launch checklist](launch-alpha.md).

**Daily digest.** `.github/workflows/daily-digest.yml` runs every day at
06:00 UTC. It posts new and waiting issues, pull requests and discussions from
outside the maintainer team to the maintainers' chat through the
`DISCORD_WEBHOOK_URL` secret. It sends
nothing when nothing is new, and skips with a notice if the secret is not
set. It only uses public data: numbers, titles, links and GitHub usernames.

GitHub disables scheduled workflows after 60 days without repository activity.
To re-enable the digest, open **Actions → Daily digest → Enable workflow** on
GitHub or run `gh workflow enable daily-digest.yml -R plainphone/plainphone`.

**Replying as the project bot.** `.github/workflows/bot-reply.yml` posts a
comment as `github-actions[bot]` on an issue, a pull request or a discussion.
Only people with write access can run it.

```sh
gh workflow run bot-reply.yml -R plainphone/plainphone \
  -f number=123 -f body="The reply text"
```

Optional inputs: `labels` (comma-separated, added to the issue or pull
request), `remove_labels` (comma-separated) and `close` (`no`, `completed` or
`not_planned`; issues only). For a long reply, pass the inputs as JSON on
stdin:

```sh
jq -n --arg number 123 --rawfile body reply.md \
  '{number: $number, body: $body, remove_labels: "needs-triage"}' |
  gh workflow run bot-reply.yml -R plainphone/plainphone --json
```

Enter the issue, pull request, or discussion number as a positive decimal
integer, optionally prefixed with `#`. The workflow adds "— the Plainphone bot"
if the signature is missing.

**Triage.** `.github/workflows/triage.yml` adds `needs-triage` to new issues
from outside the maintainer team and `external` to new pull requests from
outside the team. It also posts a short acknowledgement. It runs on
`pull_request_target` and must never check out or run code from the pull
request.
