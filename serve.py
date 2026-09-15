#!/usr/bin/env python3
"""Dev server for Throughline.

Plain `python3 -m http.server` lets the browser cache ES modules hard, so an edit can
silently not show up. This sends no-cache on everything, which is what you want while
iterating.

    python3 serve.py [port]        # default 8777
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "favicon" not in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    import os
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"Throughline → http://127.0.0.1:{port}  (no-cache; Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
