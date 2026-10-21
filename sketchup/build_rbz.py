#!/usr/bin/env python3
"""Build dist/cmrlm-design-tools.rbz.

An .rbz is a zip file. SketchUp expects the loader file and the extension folder
at the ROOT of the zip:

    cmrlm_design_tools.rb
    cmrlm_design_tools/importer.rb
    cmrlm_design_tools/main.rb

The build is deterministic: sorted entries, a fixed timestamp, fixed permissions,
and no compression (stored). The same sources always give the same bytes, so the
committed .rbz does not churn in git.

Usage: python3 sketchup/build_rbz.py
"""
import hashlib
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "dist")
OUT = os.path.join(OUT_DIR, "cmrlm-design-tools.rbz")

LOADER = "cmrlm_design_tools.rb"
FOLDER = "cmrlm_design_tools"
FIXED_TIME = (2026, 10, 21, 0, 0, 0)   # any fixed value works; this one is the spec date
SKIP_NAMES = {".DS_Store", "Thumbs.db"}
SKIP_DIRS = {"__pycache__"}


def collect():
    """Return [(archive_name, absolute_path)] sorted by archive name."""
    files = [(LOADER, os.path.join(HERE, LOADER))]
    for base, dirs, names in os.walk(os.path.join(HERE, FOLDER)):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for n in sorted(names):
            if n in SKIP_NAMES or n.endswith((".pyc", "~")):
                continue
            full = os.path.join(base, n)
            rel = os.path.relpath(full, HERE).replace(os.sep, "/")
            files.append((rel, full))
    return sorted(files)


def build():
    files = collect()
    for name, path in files:
        if not os.path.isfile(path):
            sys.exit("Missing file: " + path)
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = OUT + ".tmp"
    with zipfile.ZipFile(tmp, "w") as z:
        for name, path in files:
            with open(path, "rb") as f:
                data = f.read()
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3                 # Unix, so the mode below is read
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    os.replace(tmp, OUT)
    return files


if __name__ == "__main__":
    built = build()
    with open(OUT, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    print("Built %s" % os.path.relpath(OUT, ROOT))
    for name, _ in built:
        print("  " + name)
    print("%d bytes, sha256 %s" % (os.path.getsize(OUT), digest[:16]))
