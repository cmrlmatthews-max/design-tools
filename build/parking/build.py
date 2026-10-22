"""Assemble ../../parking/index.html from the shell and the parts in this folder.

Run: python3 build/parking/build.py

The src modules are inlined as IIFE-wrapped blocks:
    const BarsMod = (() => { ...source without "export"...; return { names }; })();
Their one-line relative imports are rewritten to destructure from the other wrapped modules, and the modules are
placed in dependency order (each one after everything it imports). The //@@MODULES@@ marker in 01_config.js takes
the whole block; a //@@MODULE key@@ marker still places a single module (and fails if the module was placed twice).
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', 'src'))
SHARED = os.path.normpath(os.path.join(HERE, '..', 'shared'))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'parking', 'index.html'))

# key -> (global name, path under src). The order here does not matter: imports set the order.
MODS = {
    # shared
    'storage': ('StorageMod', 'shared/storage.js'),
    'screenshot': ('ShotMod', 'shared/screenshot.js'),
    'sketchupFormat': ('SkFmt', 'shared/sketchup-format.js'),
    'project': ('ProjectMod', 'shared/project.js'),
    'sitelayer': ('SiteLayerMod', 'shared/sitelayer.js'),
    # tower modules the parking generator reuses (snap, prompts; snap imports envelope and geometry)
    'geometry': ('Geo', 'tower/geometry.js'),
    'envelope': ('Env', 'tower/envelope.js'),
    'snap': ('SnapMod', 'tower/snap.js'),
    'prompts': ('PromptsMod', 'tower/prompts.js'),
    # mid-rise helper the parking modules import (ringArea, multiPolyArea, clipAreaConvex)
    'bars': ('BarsMod', 'midrise/bars.js'),
    # parking modules
    'layout': ('LayoutMod', 'parking/layout.js'),
    'ramps': ('RampsMod', 'parking/ramps.js'),
    'grid': ('GridMod', 'parking/grid.js'),
    'accessible': ('AccessibleMod', 'parking/accessible.js'),
    'overlay': ('OverlayMod', 'parking/overlay.js'),
    'metrics': ('MetricsMod', 'parking/metrics.js'),
    'derived': ('ParkDerivedMod', 'parking/derived.js'),
    'exports': ('ExportsMod', 'parking/exports.js'),
    'sketchup': ('SkPark', 'parking/sketchup.js'),
    'presets': ('PresetsMod', 'parking/presets.js'),
    'testcases': ('TestCasesMod', 'parking/testcases.js'),
}
BY_PATH = {rel: key for key, (_, rel) in MODS.items()}

EXPORT_RE = re.compile(r'^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)', re.M)
# one-line imports: { a, b } from "./x.js" | "../shared/x.js" | "../tower/x.js"   (single or double quotes)
IMPORT_RE = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*["\'](\.{1,2}/[\w./-]+)["\'];?[ \t]*$', re.M)


def rd(p):
    with open(p if os.path.isabs(p) else os.path.join(HERE, p), encoding='utf-8') as f:
        return f.read()


def source_of(key):
    name, rel = MODS[key]
    path = os.path.join(SRC, rel)
    if not os.path.isfile(path):
        raise SystemExit('missing module: src/' + rel)
    return rd(path)


def imports_of(key):
    """The module keys that `key` imports (resolved against the importing file's folder)."""
    _, rel = MODS[key]
    out = []
    for m in IMPORT_RE.finditer(source_of(key)):
        target = os.path.normpath(os.path.join(os.path.dirname(rel), m.group(2))).replace(os.sep, '/')
        if target not in BY_PATH:
            raise SystemExit(f'src/{rel}: import from {m.group(2)} (src/{target}), which is not registered in MODS')
        out.append(BY_PATH[target])
    return out


def wrap(key):
    name, rel = MODS[key]
    src = source_of(key)
    exports = EXPORT_RE.findall(src)
    if not exports:
        raise SystemExit('no exports found in src/' + rel)

    def imp(m):
        target = os.path.normpath(os.path.join(os.path.dirname(rel), m.group(2))).replace(os.sep, '/')
        return f'const {{{m.group(1)}}} = {MODS[BY_PATH[target]][0]};'

    src = IMPORT_RE.sub(imp, src)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    if re.search(r'^\s*import\s', src, re.M):
        raise SystemExit('unrewritten import left in src/' + rel + ' (only one-line `import { a, b } from "./x.js"` is supported)')
    if re.search(r'^\s*export\s*\{', src, re.M):
        raise SystemExit('`export { ... }` lists are not supported in src/' + rel)
    return f'const {name} = (() => {{\n{src}\nreturn {{ {", ".join(exports)} }};\n}})();\n'


placed = []


def ordered(keys):
    """Dependency order: every module after the modules it imports. Ties keep the order of `keys`."""
    out, seen, stack = [], set(), []

    def visit(k):
        if k in seen:
            return
        if k in stack:
            raise SystemExit('import cycle: ' + ' -> '.join(stack + [k]))
        stack.append(k)
        for dep in imports_of(k):
            visit(dep)
        stack.pop()
        seen.add(k)
        out.append(k)

    for k in keys:
        visit(k)
    return out


def emit(keys):
    block = []
    for k in ordered(keys):
        if k in placed:
            continue
        placed.append(k)
        block.append(f'/* ---- src/{MODS[k][1]} ---- */\n' + wrap(k))
    return '\n'.join(block)


def part(name):
    s = rd(name)
    if '//@@MODULES@@' in s:
        s = s.replace('//@@MODULES@@', emit(list(MODS)))
    for m in re.findall(r'//@@MODULE (\w+)@@', s):
        if m not in MODS:
            raise SystemExit('unknown module marker: ' + m)
        s = s.replace(f'//@@MODULE {m}@@', emit([m]))
    return s


# ---- head: shell (ends at </style>) + the extra CSS ------------------------------------------
shell = rd('shell.html')
i_end = shell.index('</style>')
head = shell[:i_end] + rd('css_add.css') + '</style>\n'
# the classic Clipper script must run before the module
clip = '<script src="https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js"></script>\n'
head = head.replace('<style>', clip + '\n<style>', 1)
head += '</head>\n<body>\n'

# Part order (the mid-rise's, with the parking parts in place of the envelope and templates). 01_config.js holds the //@@MODULES@@ block.
PARTS = [
    '00_imports.js',
    '01_config.js',
    '02_units.js',
    '03a_state.js',
    '03b_store.js',
    '04_geometry.js',
    '05_pipeline.js',
    '05b_overlays.js',
    '05c_deck3d.js',
    '06_render.js',
    os.path.join(SHARED, '06x_sitelayer.js'),        # SiteLayer3D (shared page part)
    '06b_select.js',
    os.path.join(SHARED, '06y_placement.js'),        # PlacementGizmo (shared page part)
    '06c_site.js',                                  # SiteLayer adapter
    '07_controls.js',
    '08_ui.js',
    os.path.join(SHARED, '08x_tip.js'),            # FirstTip (shared page part)
    '08b_prompts.js',
    '08c_sketchup.js',
    '08e_help.js',
    '09_storage.js',
    '09b_project.js',
    '10_screenshot.js',
    '11_compare.js',
    '12_tests.js',
    '12b_tests_ui.js',
    '12c_tests_select.js',
    '12d_tests_project.js',
    '12e_tests_site.js',
    '12j_tests_gizmo.js',
    '12k_tests_tip.js',      # the first-visit tip
    '13_start.js',
]
missing = [p for p in PARTS if not os.path.isfile(os.path.join(HERE, p))]
if missing:
    raise SystemExit('missing parts: ' + ', '.join(missing))
js = '\n'.join(part(p) for p in PARTS)
unplaced = [k for k in MODS if k not in placed]
if unplaced:
    raise SystemExit('modules never placed: ' + ', '.join(unplaced))

html = head + rd('body.html') + '<script type="module">\n' + js + '</script>\n</body>\n</html>\n'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)
print('wrote', OUT, len(html), 'bytes', html.count('\n'), 'lines; modules:', ', '.join(placed))
