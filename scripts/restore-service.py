# SPDX-License-Identifier: Apache-2.0
"""Convert a scratch database URI into a private libpq service file."""

import ctypes as c
import os
import sys


class ConninfoOption(c.Structure):
    _fields_ = [(name, c.c_char_p) for name in (
        "keyword", "envvar", "compiled", "val", "label", "dispchar"
    )] + [("dispsize", c.c_int)]


def main():
    uri = os.environb[b"RESTORE_DATABASE_URL"]
    if not uri.startswith((b"postgres://", b"postgresql://")):
        sys.exit("Expected a PostgreSQL scratch database URI")

    libpq = c.CDLL("libpq.so.5")
    libpq.PQconninfoParse.argtypes = [c.c_char_p, c.c_void_p]
    libpq.PQconninfoParse.restype = c.POINTER(ConninfoOption)
    libpq.PQconninfoFree.argtypes = [c.POINTER(ConninfoOption)]
    libpq.PQconninfoFree.restype = None
    options = libpq.PQconninfoParse(uri, None)
    if not options:
        sys.exit("Invalid PostgreSQL scratch database URI")

    lines = [b"[plainphone-restore]"]
    try:
        for option in options:
            if option.keyword is None:
                break
            if option.val is None:
                continue
            # Service files have one setting per line and trim trailing whitespace.
            if (option.keyword == b"service" or b"\n" in option.val or
                    b"\r" in option.val or option.val != option.val.rstrip()):
                sys.exit("Scratch database URI contains an unsupported option or value")
            lines.append(option.keyword + b"=" + option.val)
    finally:
        libpq.PQconninfoFree(options)
    sys.stdout.buffer.write(b"\n".join(lines) + b"\n")


if __name__ == "__main__":
    main()
