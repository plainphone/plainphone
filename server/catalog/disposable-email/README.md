# Disposable mail domains

`domains.txt` is the blocklist from
[disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains)
(`disposable_email_blocklist.conf`), released under CC0 1.0 (`LICENSE.txt`). The server reads it
once at start-up and never looks anything up over the network. It is only used when a new
household signs up and `BLOCK_DISPOSABLE_EMAIL` is on (docs/operations.md, "Bot and spam
protection").

`allow.txt` lists domains that are never blocked, even if the upstream list adds them later.

Refresh it with:

```sh
node server/scripts/update-disposable-domains.mjs
```

The script prints how many domains were added and removed. Read the diff before you commit it.
