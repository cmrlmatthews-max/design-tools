"""Assemble ../../tower/index.html from the shell and the parts in this folder.

Run: python3 build/tower/build.py

The src modules are inlined as IIFE-wrapped blocks:
    const Geo = (() => { ...source without "export"...; return { names }; })();
Their one-line relative imports (`import { a, b } from "./x.js"`, "../shared/x.js", single or double quotes) are
rewritten to destructure from the other wrapped modules, and every module is placed after the modules it imports.
A //@@MODULE key@@ marker in a part places that module (and, first, anything it imports that is not placed yet);
a marker for a module that is already placed emits nothing. The ('modules', [...]) entry in PARTS places the
project-file and sun-study modules right after 01_config.js, so every later part can use them at load time.

The modules in OPTIONAL may not exist yet (other build phases write them). A missing one prints a warning and
becomes an empty global (`const SolarMod = {};`), so the page still builds; the next build picks up the real file.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', 'src'))
SHARED = os.path.normpath(os.path.join(HERE, '..', 'shared'))      # page parts shared by the tools (docs/site-layer-technical-plan.md section 7)
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'tower', 'index.html'))

# key -> (global name, path under src). The order here does not matter: the markers and the imports set the order.
MODS = {
    'presets': ('PresetsMod', 'tower/presets.js'),
    'geometry': ('Geo', 'tower/geometry.js'),
    'envelope': ('Env', 'tower/envelope.js'),
    'storage': ('StorageMod', 'shared/storage.js'),
    'screenshot': ('ShotMod', 'shared/screenshot.js'),
    'prompts': ('PromptsMod', 'tower/prompts.js'),           # the AI prompt library (data only)
    'testcases': ('TestCasesMod', 'tower/testcases.js'),
    'snap': ('SnapMod', 'tower/snap.js'),                    # v1.1 snapping (reads Env and Geo)
    'sketchupFormat': ('SkFmt', 'shared/sketchup-format.js'),
    'sketchupTower': ('SkTower', 'tower/sketchup.js'),
    # project file and sun study (docs/tower-project-sun-plan.md section 4), in import order
    'project': ('ProjectMod', 'shared/project.js'),
    'towerDerived': ('TowerDerivedMod', 'tower/derived.js'),
    'solar': ('SolarMod', 'shared/solar.js'),
    'sunhours': ('SunHoursMod', 'tower/sunhours.js'),
    # the shared site layer (docs/site-layer-technical-plan.md): data only, placed by the marker at the top of 06c_site.js
    'sitelayer': ('SiteLayerMod', 'shared/sitelayer.js'),
}
OPTIONAL = {'towerDerived', 'solar', 'sunhours'}
BY_PATH = {rel: key for key, (_, rel) in MODS.items()}

EXPORT_RE = re.compile(r'^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)', re.M)
# one-line imports: { a, b } from "./x.js" | "../shared/x.js" | "../tower/x.js"   (single or double quotes)
IMPORT_RE = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*["\'](\.{1,2}/[\w./-]+)["\'];?[ \t]*$', re.M)


def rd(p):
    with open(p if os.path.isabs(p) else os.path.join(HERE, p), encoding='utf-8') as f:
        return f.read()


def exists(key):
    return os.path.isfile(os.path.join(SRC, MODS[key][1]))


def source_of(key):
    name, rel = MODS[key]
    if not exists(key):
        if key in OPTIONAL:
            return None
        raise SystemExit('missing module: src/' + rel)
    return rd(os.path.join(SRC, rel))


def resolve(rel, spec):
    return os.path.normpath(os.path.join(os.path.dirname(rel), spec)).replace(os.sep, '/')


def imports_of(key):
    """The module keys that `key` imports (resolved against the importing file's folder). A missing module imports nothing."""
    _, rel = MODS[key]
    src = source_of(key)
    if src is None:
        return []
    out = []
    for m in IMPORT_RE.finditer(src):
        target = resolve(rel, m.group(2))
        if target not in BY_PATH:
            raise SystemExit(f'src/{rel}: import from {m.group(2)} (src/{target}), which is not registered in MODS')
        out.append(BY_PATH[target])
    return out


def wrap(key):
    name, rel = MODS[key]
    src = source_of(key)
    if src is None:
        print(f'warning: src/{rel} does not exist yet; {name} is an empty stub')
        return f'const {name} = {{}};   // src/{rel} is missing: an empty stub until that module is written\n'
    exports = EXPORT_RE.findall(src)
    if not exports:
        raise SystemExit('no exports found in src/' + rel)

    def imp(m):
        return f'const {{{m.group(1)}}} = {MODS[BY_PATH[resolve(rel, m.group(2))]][0]};'

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
    for m in re.findall(r'//@@MODULE (\w+)@@', s):
        if m not in MODS:
            raise SystemExit('unknown module marker: ' + m)
        s = s.replace(f'//@@MODULE {m}@@', emit([m]))
    return s


shell = rd('shell.html').split('\n')


def find(prefix, start=0):
    for i in range(start, len(shell)):
        if shell[i].startswith(prefix):
            return i
    raise SystemExit('not found: ' + prefix)


# ---- head / css -------------------------------------------------------------
i_style_end = find('</style>')
i_script = find('<script type="module">')
head = '\n'.join(shell[:i_style_end]) + '\n' + rd('css_add.css') + '</style>\n'
# the classic Clipper script must run before the module
clip = '<script src="https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js"></script>\n'
head = head.replace('<style>', clip + '\n<style>', 1)
head += '</head>\n<body>\n'

# ---- shell pieces kept verbatim ---------------------------------------------------
i_units = find('   SHARED: units') - 1            # the "/* ====" line above
j = i_units
while not (shell[j] == '})();' and j > find('const Units')):
    j += 1
units_block = '\n'.join(shell[i_units:j + 1]) + '\n\n'
i_store = find('const Store = (() => {')
j = i_store
while shell[j] != '})();':
    j += 1
store_block = '\n'.join(shell[i_store:j + 1]) + '\n\n'

imports = '\n'.join(shell[i_script + 1:i_script + 4]) + '\n\n'   # three, OrbitControls, BufferGeometryUtils

# ---- parts, in page order -----------------------------------------------------------
# A string is a part file; ('modules', keys) places those modules; ('shell', text) is a verbatim shell block.
PARTS = [
    '01_config.js',
    ('modules', ['project', 'towerDerived', 'solar', 'sunhours']),
    ('shell', units_block),
    '03a_state.js',
    ('shell', store_block),
    '04_geometry.js',
    '05_envelope.js',
    '06_render.js',
    os.path.join(SHARED, '06x_sitelayer.js'),     # SiteLayer3D (shared)
    '06b_select.js',
    os.path.join(SHARED, '06y_placement.js'),     # PlacementGizmo (shared; phase C)
    '06c_site.js',            # SiteLayer (the adapter of SiteLayer3D)
    '06d_sunhours.js',        # SunLayer
    '07_controls.js',
    '08_ui.js',
    os.path.join(SHARED, '08x_tip.js'),            # FirstTip (shared page part)
    '08b_prompts.js',
    '08c_sketchup.js',
    '08d_sun.js',             # SunUI
    '09_storage.js',
    '09b_project.js',         # ProjectUI
    '10_screenshot.js',
    '10b_sunstudy.js',        # SunStudy
    '11_compare.js',
    '12_tests.js',
    '12b_tests_layout.js',
    '12c_tests_select.js',
    '12d_tests_new.js',
    '12e_tests_sketchup.js',
    '12f_tests_project.js',
    '12g_tests_sun.js',
    '12h_tests_nosite.js',
    '12i_tests_site.js',      # the site layer (tests 1 to 6)
    '12j_tests_gizmo.js',     # placement gizmo tests (phase C)
    '12k_tests_tip.js',      # the first-visit tip
    '13_start.js',
]
# parts another build phase writes: left out until the file exists
OPTIONAL_PARTS = {os.path.join(SHARED, '06y_placement.js'), '12j_tests_gizmo.js'}
for _p in sorted(OPTIONAL_PARTS):
    if _p in PARTS and not os.path.isfile(os.path.join(HERE, _p)):
        print('warning: optional part not written yet, left out:', os.path.basename(_p))
        PARTS.remove(_p)
missing = [p for p in PARTS if isinstance(p, str) and not os.path.isfile(os.path.join(HERE, p))]
if missing:
    raise SystemExit('missing parts: ' + ', '.join(missing))


def piece(p):
    if isinstance(p, str):
        return part(p) + '\n'
    kind, val = p
    if kind == 'modules':
        return emit(val) + '\n'
    return val


js = imports + ''.join(piece(p) for p in PARTS)
unplaced = [k for k in MODS if k not in placed]
if unplaced:
    raise SystemExit('modules never placed: ' + ', '.join(unplaced))

html = head + rd('body.html') + '<script type="module">\n' + js + '</script>\n</body>\n</html>\n'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)
print('wrote', OUT, len(html), 'bytes', html.count('\n'), 'lines; modules:', ', '.join(placed))
