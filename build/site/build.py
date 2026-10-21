"""Assemble ../../site/index.html from the shell and the parts in this folder.

Run: python3 build/site/build.py

The src/site and src/shared modules are inlined as IIFE-wrapped blocks:
    const GeoMod = (() => { ...source without "export"...; return { names }; })();
Their relative imports are rewritten to destructure from the other wrapped modules.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', 'src'))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'site', 'index.html'))

# key -> (global name, path under src). Order does not matter here; the //@@MODULE key@@ markers set the output order.
MODS = {
    'geo': ('GeoMod', 'site/geo.js'),
    'geocode': ('GeocodeMod', 'site/geocode.js'),
    'pmtiles': ('PMTilesMod', 'site/pmtiles.js'),
    'mvt': ('MvtMod', 'site/mvt.js'),
    'tiff': ('TiffMod', 'site/tiff.js'),
    'model': ('ModelMod', 'site/model.js'),
    'exports': ('ExportsMod', 'site/exports.js'),
    # SketchUp export. sketchupFormat must come before sketchup in 01_config.js (the site module reads SkFmt at load time).
    'sketchupFormat': ('SkFmt', 'shared/sketchup-format.js'),
    'sketchup': ('SkSite', 'site/sketchup.js'),
    'screenshot': ('ShotMod', 'shared/screenshot.js'),
    # Project file (docs/project-file-spec.md). derived.js imports cleanRing2, so its marker comes after sketchupFormat.
    'project': ('ProjectMod', 'shared/project.js'),
    'derived': ('SiteDerivedMod', 'site/derived.js'),
}
BY_FILE = {os.path.basename(p): g for g, p in MODS.values()}

EXPORT_RE = re.compile(r'^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)', re.M)
# "./x.js" and "../shared/x.js" (the shared modules are found by file name)
IMPORT_RE = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*["\']\.{1,2}/(?:shared/)?([\w.-]+)["\'];?[ \t]*$', re.M)


def rd(p):
    with open(p if os.path.isabs(p) else os.path.join(HERE, p), encoding='utf-8') as f:
        return f.read()


def wrap(key):
    name, rel = MODS[key]
    if not os.path.isfile(os.path.join(SRC, rel)):
        raise SystemExit('missing module: src/' + rel)
    src = rd(os.path.join(SRC, rel))
    exports = EXPORT_RE.findall(src)
    if not exports:
        raise SystemExit('no exports found in ' + rel)

    def imp(m):
        target = m.group(2)
        if target not in BY_FILE:
            raise SystemExit(f'{rel}: import from unknown module {target}')
        return f'const {{{m.group(1)}}} = {BY_FILE[target]};'

    src = IMPORT_RE.sub(imp, src)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    if re.search(r'^import\s', src, re.M):
        raise SystemExit('unrewritten import left in ' + rel)
    return f'const {name} = (() => {{\n{src}\nreturn {{ {", ".join(exports)} }};\n}})();\n'


def part(name):
    s = rd(name)
    for m in re.findall(r'//@@MODULE (\w+)@@', s):
        s = s.replace(f'//@@MODULE {m}@@', wrap(m))
    return s


# ---- head: shell (ends at </style>) + the extra CSS ------------------------------------------
shell = rd('shell.html')
i_end = shell.index('</style>')
head = shell[:i_end] + rd('css_add.css') + '</style>\n'
# the classic Clipper script must run before the module
clip = '<script src="https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js"></script>\n'
head = head.replace('<style>', clip + '\n<style>', 1)
head += '</head>\n<body>\n'

PARTS = ['00_imports.js', '01_config.js', '02_pipeline.js', '03_scene.js', '04_ui.js', '05_tests.js', '06_start.js']
js = '\n'.join(part(p) for p in PARTS)

html = head + rd('body.html') + '<script type="module">\n' + js + '</script>\n</body>\n</html>\n'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)
print('wrote', OUT, len(html), 'bytes', html.count('\n'), 'lines')
