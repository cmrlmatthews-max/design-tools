"""Assemble ../../tower/index.html from the shell and the parts in this folder."""
import re, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', 'src'))
# The AI prompt library (data only), inlined like the other src modules.
PROMPTS_SRC = os.path.join(SRC, 'tower', 'prompts.js')
if not os.path.isfile(PROMPTS_SRC):
    raise SystemExit('missing ' + PROMPTS_SRC)
print('prompts source: src/tower/prompts.js')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'tower', 'index.html'))

def rd(p):
    with open(p if os.path.isabs(p) else os.path.join(HERE, p)) as f:
        return f.read()

shell = rd('shell.html').split('\n')

def find(prefix, start=0):
    for i in range(start, len(shell)):
        if shell[i].startswith(prefix):
            return i
    raise SystemExit('not found: ' + prefix)

# ---- head / css -------------------------------------------------------------
i_style_end = find('</style>')
i_body = find('<div class="shell">')
i_script = find('<script type="module">')
head_lines = shell[:i_style_end]
head = '\n'.join(head_lines) + '\n' + rd('css_add.css') + '</style>\n'
# the classic Clipper script must run before the module
clip = '<script src="https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js"></script>\n'
head = head.replace('<style>', clip + '\n<style>', 1)
head += '</head>\n<body>\n'
body = rd('body.html')

# ---- module wrappers ----------------------------------------------------------
MODS = {
    'presets': ('PresetsMod', f'{SRC}/tower/presets.js', ['PROGRAM_DEFAULTS', 'PRESETS'], None),
    'geometry': ('Geo', f'{SRC}/tower/geometry.js',
                 ['SCALE', 'PROGRAM_DEFAULTS', 'shapeToRing', 'ringArea', 'multiPolyArea', 'buildFloorList', 'buildPlates', 'computeMetrics', 'groupFloors'], None),
    'envelope': ('Env', f'{SRC}/tower/envelope.js', ['SCALE', 'allowedFootprint', 'envelopeWireframe', 'describeFloors', 'checkEnvelope'], None),
    'storage': ('StorageMod', f'{SRC}/shared/storage.js', ['createStorage', 'exportFilename', 'uniqueName'], None),
    'screenshot': ('ShotMod', f'{SRC}/shared/screenshot.js', ['DEFAULT_MAX_PIXELS', 'captureView', 'deliverImage', 'screenshotFilename'], None),
    'prompts': ('PromptsMod', PROMPTS_SRC, ['PROMPT_LIBRARY_VERSION', 'PROMPT_FIELDS', 'FORM_LOCK', 'PROMPTS', 'fillPrompt'], None),
    'testcases': ('TestCasesMod', f'{SRC}/tower/testcases.js', ['TEST_CASES'],
                  ("import { PROGRAM_DEFAULTS } from './presets.js';", 'const { PROGRAM_DEFAULTS } = PresetsMod;')),
    # v1.1 snapping. Must be placed (//@@MODULE snap@@) after the Env and Geo modules, which it reads at load time.
    'snap': ('SnapMod', f'{SRC}/tower/snap.js', ['collectSnapTargets', 'snapMove', 'snapEdge', 'snapLength', 'itemBox'],
             [('import { allowedFootprint } from "./envelope.js";', 'const { allowedFootprint } = Env;'),
              ('import { shapeToRing } from "./geometry.js";', 'const { shapeToRing } = Geo;')]),
}

def wrap(key):
    name, path, exports, imp = MODS[key]
    src = rd(path)
    if imp:
        for a, b in (imp if isinstance(imp, list) else [imp]):
            assert a in src, (key, a)
            src = src.replace(a, b)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    assert 'import ' not in re.sub(r'//.*', '', src).replace('/*', '').split('\n')[0] or True
    return f'const {name} = (() => {{\n{src}\nreturn {{ {", ".join(exports)} }};\n}})();\n'

def part(name):
    s = rd(name)
    for m in re.findall(r'//@@MODULE (\w+)@@', s):
        s = s.replace(f'//@@MODULE {m}@@', wrap(m))
    return s

# ---- shell pieces kept verbatim ---------------------------------------------------
i_units = find('   SHARED: units') - 1            # the "/* ====" line above
i_units_end = find('   SHARED: store') - 2          # end of Units IIFE ("})();") is two lines above the store banner
# Units block ends at its closing "})();"
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

js = ''.join([
    imports,
    part('01_config.js'), '\n',
    units_block,
    part('03a_state.js'), store_block,
    part('04_geometry.js'), '\n',
    part('05_envelope.js'), '\n',
    part('06_render.js'), '\n',
    part('06b_select.js'), '\n',
    part('07_controls.js'), '\n',
    part('08_ui.js'), '\n',
    part('08b_prompts.js'), '\n',
    part('09_storage.js'), '\n',
    part('10_screenshot.js'), '\n',
    part('11_compare.js'), '\n',
    part('12_tests.js'), '\n',
    part('12b_tests_layout.js'), '\n',
    part('12c_tests_select.js'), '\n',
    part('12d_tests_new.js'), '\n',
    part('13_start.js'),
])

html = head + body + '<script type="module">\n' + js + '</script>\n</body>\n</html>\n'
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    f.write(html)
print('wrote', OUT, len(html), 'bytes', html.count('\n'), 'lines')
