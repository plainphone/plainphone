# How we handle your contribution

Plainphone is a small project with one maintainer. This page says what happens
after you open an issue, a pull request or a discussion, so you know what to
expect.

## Issues or Discussions

- **Issues** are for bugs and concrete tasks: something that does not work as
  described, or a change that is clear enough to start on.
- **[Discussions](https://github.com/plainphone/plainphone/discussions)** are
  for everything else. Ask in **Q&A** if you need help with setup or want to
  know how something works. Post in **Ideas** if a change needs to be talked
  through first. **Announcements** is where maintainers post news.

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

A maintainer reads every new issue, usually within a few days. It can take
longer, and there is no guaranteed response time.

New issues get the `needs-triage` label automatically. When a maintainer has
looked at an issue, the label is replaced by one or more of these:

| Label | Meaning |
|---|---|
| `bug` | Something does not work as described. |
| `enhancement` | A change to how Plainphone works. |
| `documentation` | Docs, README or website text. |
| `accessibility` | A barrier for people with disabilities. |
| `question` | Needs more information or a decision. |
| `good first issue` | Small and well defined, good for a first contribution. |
| `help wanted` | Help from outside the core team is welcome. |
| `blocked` | Waiting on something else before work can continue. |
| `external` | Pull request from someone outside the maintainer team. |
| `awaiting-maintainer` | Reviewed and waiting for a maintainer decision. |
| `duplicate` | Already covered by another issue or pull request. |
| `wontfix` | Will not be done, with a reason in the thread. |
| `invalid` | Not a Plainphone issue, or cannot be reproduced. |

## Replies from the project bot

Some replies come from the project bot (`github-actions[bot]`), signed "the
Plainphone bot". It confirms that an issue or pull request has arrived, and it
also posts technical answers and review notes that a maintainer has asked it
to send. Decisions to merge, close as `wontfix` or change the plan are always
made by a maintainer.

## How a pull request from outside is reviewed

1. **CI.** Workflow runs for pull requests from outside contributors start
   only after a maintainer has approved them. That is a safety rule for a
   public repository, not a judgement of your change.
2. **An automated review.** The change is reviewed against the code, the
   [design principles](design-principles.md) and the
   [evidence review](evidence.md). You may get comments to address.
3. **A maintainer decides.** When CI is green and the review has no open
   blocking findings, the pull request gets `awaiting-maintainer`. A
   maintainer then merges it, asks for changes or explains why it will not
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
  they are fixed or a maintainer explains why not.
- An issue or Q&A question that is waiting for information from you is
  closed after 30 days without an answer. You can reopen it, or open a new
  one, when you have the details.
- Duplicates are closed with a link to the original.
- `wontfix` is closed with a reason in the thread.

## Licence of contributions

There is no contributor licence agreement and no sign-off requirement. By
submitting a contribution you agree it is licensed under Apache-2.0
(section 5 of the [licence](../LICENSE)).

## For maintainers

**Daily digest.** `.github/workflows/daily-digest.yml` runs every day at
06:00 UTC and posts new and waiting issues, pull requests and discussions to
the maintainers' chat through the `DISCORD_WEBHOOK_URL` secret. It sends
nothing when nothing is new, and skips with a notice if the secret is not
set. It only uses public data: numbers, titles, links and GitHub usernames.

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

End bot replies with "— the Plainphone bot".

**Triage.** `.github/workflows/triage.yml` adds `needs-triage` to new issues
and `external` to pull requests from outside the maintainer team, and posts
a short acknowledgement to people outside the team. It runs on
`pull_request_target` and must never check out or run code from the pull
request.
