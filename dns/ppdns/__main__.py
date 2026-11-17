# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""ppdns command line.

  python -m ppdns init                 write the first AdGuardHome.yaml and build the tagged lists
  python -m ppdns serve                run the HTTP API and the background jobs
  python -m ppdns create child|self [--block-adult|--allow-adult] [--categories social,gambling,...]
  python -m ppdns list
  python -m ppdns show <client-id>
  python -m ppdns delete <client-id>
  python -m ppdns selftest             one DoT self-test, exit 1 on failure
  python -m ppdns backup               back up AdGuardHome.yaml now (local + S3 if configured)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(prog="ppdns")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    sub.add_parser("serve")
    create = sub.add_parser("create")
    create.add_argument("profile", choices=["child", "self"])
    adult = create.add_mutually_exclusive_group()
    adult.add_argument("--block-adult", dest="block_adult", action="store_true", default=None)
    adult.add_argument("--allow-adult", dest="block_adult", action="store_false")
    create.add_argument("--categories", help="comma-separated blocked categories (default: all for child, none for self)")
    sub.add_parser("list")
    for name in ("show", "delete"):
        sub.add_parser(name).add_argument("client_id")
    sub.add_parser("selftest")
    sub.add_parser("backup")
    args = parser.parse_args(argv)

    from . import config

    settings = config.Settings.from_env()
    if args.command == "init":
        from . import lists

        if config.write_first_config(settings):
            logging.info("wrote %s", settings.config_path)
        else:
            logging.info("%s exists, left as is", settings.config_path)
        print(json.dumps(lists.build(settings.lists_dir, max_age=settings.lists_refresh_hours * 3600)))
        return 0
    if args.command == "backup":
        from . import backup

        print(backup.run(settings.conf_dir, settings.data_dir, settings.backup_keep))
        return 0
    if args.command == "serve":
        from .server import serve

        serve(settings)
        return 0

    from .adguard import AdGuard
    from .service import Service

    service = Service(
        AdGuard(settings.adguard_url, settings.adguard_user, settings.adguard_password),
        settings.domain,
        settings.data_dir,
    )
    if args.command == "create":
        categories = None if args.categories is None else [c for c in args.categories.split(",") if c]
        out = service.create(args.profile, args.block_adult, blocked_categories=categories)
    elif args.command == "list":
        out = service.list()
    elif args.command == "show":
        out = service.get(args.client_id)
    elif args.command == "delete":
        service.delete(args.client_id)
        out = {"deleted": args.client_id}
    else:  # selftest
        from .server import Jobs

        jobs = Jobs(settings, service)
        jobs.monitor_id = service.ensure_monitor_client()
        ok, message = jobs.selftest()
        print(message)
        return 0 if ok else 1
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
