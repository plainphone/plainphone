# SPDX-License-Identifier: Apache-2.0
"""Local HTTP fixture for AWS CLI object transfers and heartbeat delivery."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

objects = {}
heartbeats = []


class Handler(BaseHTTPRequestHandler):
    def do_PUT(self):
        if self.path.startswith("/reject/"):
            self.send_error(403)
            return
        objects[self.path] = self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(200)
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if self.path == "/health":
            data = b"ok"
        elif self.path == "/heartbeat":
            heartbeats.append(1)
            data = b"ok"
        elif self.path == "/heartbeat-count":
            data = str(len(heartbeats)).encode()
        else:
            data = objects.get(self.path)
        self.send_response(404 if data is None else 200)
        self.send_header("Last-Modified", "Sun, 04 Jan 2026 03:00:00 GMT")
        self.send_header("Content-Length", str(len(data or b"")))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data or b"")


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
