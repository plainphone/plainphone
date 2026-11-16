# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""ppdns command line.

  python -m ppdns init                 write the first AdGuardHome.yaml and build the tagged lists
  python -m ppdns serve                run the HTTP API and the background jobs
  python -m ppdns create child|self [--block-adult|--allow-adult]
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

from . import backup, config, lists
from .adguard import AdGuard
from .server import Jobs, serve
from .service import Service


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
    sub.add_parser("list")
    for name in ("show", "delete"):
        sub.add_parser(name).add_argument("client_id")
    sub.add_parser("selftest")
    sub.add_parser("backup")
    args = parser.parse_args(argv)

    settings = config.Settings.from_env()
    if args.command == "init":
        if config.write_first_config(settings):
            logging.info("wrote %s", settings.config_path)
        else:
            logging.info("%s exists, left as is", settings.config_path)
        print(json.dumps(lists.build(settings.lists_dir)))
        return 0
    if args.command == "backup":
        print(backup.run(settings.conf_dir, settings.data_dir, settings.backup_keep))
        return 0
    if args.command == "serve":
        serve(settings)
        return 0

    service = Service(
        AdGuard(settings.adguard_url, settings.adguard_user, settings.adguard_password),
        settings.domain,
        settings.data_dir,
    )
    if args.command == "create":
        out = service.create(args.profile, args.block_adult)
    elif args.command == "list":
        out = service.list()
    elif args.command == "show":
        out = service.get(args.client_id)
    elif args.command == "delete":
        service.delete(args.client_id)
        out = {"deleted": args.client_id}
    else:  # selftest
        jobs = Jobs(settings, service)
        jobs.monitor_id = service.ensure_monitor_client()
        ok, message = jobs.selftest()
        print(message)
        return 0 if ok else 1
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
