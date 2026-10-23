// AI prompt library for the tower massing tool.
// The architect exports a white massing screenshot, then pastes it with one of these
// prompts into ChatGPT (image generation) or Gemini (image editing) to get a
// photo-real rendering of that exact massing.
// Data + fillPrompt only. No DOM access.
//
// Auto fields (the panel computes them from the current option):
//   {{floors}} {{height}} {{program}} {{podium}} {{form}}
//   {{hero}}  the Hero render prompt only: the sentences about the hero building, from heroFor() below (the panel passes it in the values)
// Pick fields (the user chooses them in the panel): see PROMPT_FIELDS.
// Pick values are written to read naturally in the template sentences:
//   material -> "The facade is {{material}}."
//   location -> "The setting is {{location}}."
//   time     -> "photographed {{time}}"   (values start with "in", "at" or "under")
//   season   -> "..., {{season}}."        (values start with "in")
// Templates never write "a {{program}}" (avoids "a office"); they use "this {{program}} tower".
// {{podium}} always follows "with" ("with a 4-story podium" / "with no podium").

export const PROMPT_LIBRARY_VERSION = 2;

// The Hero render's time (Cade's reference prompt): reads after "photographed".
const DUSK = "at dusk under a deep blue sky with a warm glow near the horizon";
const AUTUMN = "in autumn with orange, red, and gold foliage";
const FRITTED = "white-fritted glass with slim horizontal aluminum sunshades at each floor";

export const PROMPT_FIELDS = {
  material: {
    label: "Facade material",
    options: [
      { value: "a unitized glass curtain wall with slim vertical mullions and a spandrel band at each floor", label: "Glass curtain wall" },
      { value: "light gray precast concrete panels with recessed punched windows", label: "Precast, punched windows" },
      { value: "clear glazing behind vertical terracotta baguettes in a warm clay color", label: "Terracotta baguettes" },
      { value: "ribbed champagne-anodized aluminum panels in horizontal bands with glass", label: "Ribbed metal panel" },
      { value: "warm red-brown brick with tall windows set in deep reveals", label: "Brick, deep reveals" },
      { value: "floor-to-ceiling glass revealing an exposed mass timber structure", label: "Mass timber and glass" },
      { value: "white-fritted glass with slim horizontal aluminum sunshades at each floor", label: "Fritted glass, sunshades" },
      { value: "dark bronze anodized metal and glass in a crisp vertical grid", label: "Dark bronze grid" },
      { value: "pale limestone panels with narrow vertical window strips", label: "Limestone and glass" },
    ],
    default: "a unitized glass curtain wall with slim vertical mullions and a spandrel band at each floor",
  },
  location: {
    label: "Site context",
    options: [
      { value: "a dense US downtown with a mix of older and newer towers", label: "Dense US downtown" },
      { value: "a Southern US city with live oaks and Spanish moss along wide streets", label: "Southern city, live oaks" },
      { value: "a Florida waterfront with palms and a concrete seawall", label: "Florida waterfront" },
      { value: "a growing Sunbelt city with wide streets and young shade trees", label: "Sunbelt city" },
      { value: "a Pacific Northwest city with tall evergreens and nearby hills", label: "Pacific Northwest city" },
      { value: "a Midwest river city with brick warehouses and steel bridges", label: "Midwest river city" },
      { value: "a Southwest desert city with palo verde trees and distant mountains", label: "Southwest desert city" },
      { value: "a Northeast city neighborhood with brownstones and mature street trees", label: "Northeast neighborhood" },
      { value: "a California coastal city with tall palms and distant hills", label: "California coastal city" },
    ],
    default: "a dense US downtown with a mix of older and newer towers",
  },
  time: {
    label: "Time of day",
    options: [
      { value: DUSK, label: "Dusk, deep blue sky" },
      { value: "in late-afternoon golden hour light with low warm sun raking across the facade", label: "Golden hour" },
      { value: "in clear late-morning sun under a deep blue sky", label: "Late morning, clear" },
      { value: "in high afternoon sun with crisp short shadows", label: "Bright afternoon" },
      { value: "under a partly cloudy sky with soft moving cloud shadows", label: "Partly cloudy" },
      { value: "in soft even light under a bright overcast sky", label: "Overcast" },
      { value: "in early morning light with a thin haze and cool shadows", label: "Early morning haze" },
      { value: "in the blue hour just after sunset with interior lights coming on", label: "Blue hour" },
      { value: "at night with warm interior lights on against a dark sky", label: "Night" },
    ],
    default: "in late-afternoon golden hour light with low warm sun raking across the facade",
  },
  season: {
    label: "Season",
    options: [
      { value: "in spring with fresh light-green leaves and a few flowering trees", label: "Spring" },
      { value: "in early summer with full green trees and lawns", label: "Summer" },
      { value: "in late summer with deep green trees and a light heat haze", label: "Late summer" },
      { value: "in autumn with orange, red, and gold foliage", label: "Autumn" },
      { value: "in winter with bare trees and dry pavement, no snow", label: "Winter, no snow" },
      { value: "in winter with a light dusting of snow on roofs, ground, and branches", label: "Winter, light snow" },
      { value: "in a mild Southern winter with evergreen trees and green lawns", label: "Mild Southern winter" },
    ],
    default: "in early summer with full green trees and lawns",
  },
};

// Fixed rule block, prepended to every prompt. Uses {{form}} and {{floors}}.
export const FORM_LOCK =
  "Turn the attached massing model into a photo-real architectural photograph. " +
  "Treat the image as the exact massing of {{form}}. " +
  "Keep its silhouette, proportions, setbacks, podium or base, crown, and all {{floors}} floors with the same floor-line rhythm. " +
  "Keep the same camera angle, perspective, and framing. " +
  "Do not add, remove, stretch, or reshape any floor, wing, or tower of this building. " +
  "Only add materials, glazing, lighting, sky, context, and people. " +
  "Render each light-gray block as a neighboring building of the same size and position. " +
  "Flat white and gray are placeholders, not materials.";

const AVOID_BASE = "text, logos, watermarks";
const AVOID_END = "fisheye distortion, cartoon or illustration look.";

// Shared opening. Skyline and base close-up prompts write their own.
const OPEN = "Architectural photograph of this {{program}} tower, about {{height}} tall with {{podium}}";


/* ------------------------------------------------------------------------------------------ the hero building
   heroFor(tool, state, data) writes the {{hero}} text of the Hero render prompt from a tool's own state.
   tool: 'tower' | 'midrise' | 'parking' | 'facade' | 'grading'.
   data: the second argument of that tool's autoValues(state, data):
         tower   Derived.get().metrics  { floorCount, totalHeight }
         midrise Derived.get().metrics  { floors, height }
         parking Derived.get().hud      { levels, topOfDeck }
         facade  Derived.get()          { hud: { levels, height, wwr, zones }, faces, levels }
         grading Derived.get()          { hud: { tierCount, wallCount, wallMax }, built: { buildings } }
   Returns a short paragraph plus "* " lines, no tokens, no "[". It never throws: a state it cannot read gives a plain sentence. */
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n) => (n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n));
const oxford = (list) => (list.length <= 1 ? list.join("") : list.length === 2 ? `${list[0]} and ${list[1]}` : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`);
const nz = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const feet = (v) => `${Math.round(nz(v))} feet`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const articleFor = (phrase) => (/^(?:[aeio]|L-|8|11|18)/i.test(phrase) ? "an" : "a");
const RENDER_ONLY = "Render only this building in full photographic detail.";
const HERO_FALLBACK = `The hero building is the building at the center of the image. ${RENDER_ONLY}`;
const TOWER_SHAPES = { rect: "rectangular", square: "rectangular", circle: "round", ellipse: "elliptical", triangle: "triangular", L: "L-shaped", U: "U-shaped", polygon: "custom-shaped" };
const CROWNS = { none: "a flat roof", flat: "a flat roof", stepped: "a stepped crown", sloped: "a sloped crown", spire: "a spire", screen: "a rooftop screen" };
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const FACADE_SYSTEMS = {
  punched: "punched windows in a solid wall", windowWall: "window wall with glass between slab-edge spandrels",
  curtainWall: "curtain wall with vision glass and opaque spandrels", storefront: "storefront glazing", solid: "solid wall panels",
};

function heroTower(state, m) {
  const segs = (state.segments || []).filter(Boolean);
  let tall = null, tallH = -1;
  for (const sg of segs) { const h = nz(sg.floors) * nz(sg.ftf); if (h > tallH) { tall = sg; tallH = h; } }
  const twist = segs.some((sg) => nz(sg.twist && sg.twist.deg) !== 0);
  const taper = segs.some((sg) => nz(sg.taper && sg.taper.x) !== 0 || nz(sg.taper && sg.taper.y) !== 0);
  const shape = TOWER_SHAPES[tall && tall.shape && tall.shape.type] || "custom-shaped";
  const lead = [twist ? "twisting" : "", taper ? "tapering" : "", shape].filter(Boolean).join(" ");
  const pod = state.podium && state.podium.on ? Math.max(1, Math.round(nz(state.podium.floors, 1))) : 0;
  const out = [`The hero building is the ${lead} tower at the center of the image.${pod ? ` It stands on ${articleFor(String(pod))} ${pod}-story podium.` : ""} ${RENDER_ONLY}`];
  out.push(`* Height is about ${feet(m.totalHeight)}.`);
  const crown = CROWNS[state.crown && state.crown.type] || "a flat roof";
  out.push(`* The tower has ${Math.round(nz(m.floorCount))} floors and ${crown}.`);
  const nSet = (state.setbacks || []).length, nCarve = (state.carves || []).length;
  if (nSet || nCarve) out.push(`* It has ${oxford([nSet ? plural(countWord(nSet), "setback", "setbacks") : "", nCarve ? "a sky garden" : ""].filter(Boolean))}. Keep them exactly as the massing shows them.`);
  const prog = [];
  for (const sg of segs) {
    const name = sg.program ? String(sg.program) : "";
    if (!name) continue;
    const last = prog[prog.length - 1];
    if (last && last.name === name) last.floors += nz(sg.floors); else prog.push({ name, floors: nz(sg.floors) });
  }
  if (prog.length === 1) out.push(`* The program is ${prog[0].name}.`);
  else if (prog.length) out.push(`* From the bottom up, the floors hold ${oxford(prog.map((x) => `${Math.round(x.floors)} ${x.floors === 1 ? "floor" : "floors"} of ${x.name}`))}.`);
  if (twist) out.push("* Each floor plate rotates slightly from the floor below. Keep the twist exactly as the massing shows it.");
  if (taper) out.push("* The floor plates change in size with height. Keep the taper exactly as the massing shows it.");
  return out.join("\n");
}

function heroMidrise(state, m) {
  const bars = (state.bars || []).filter(Boolean), courts = (state.courts || []).length;
  const deck = !!(state.deck && state.deck.on);
  const type = state.type;
  let adj;
  if (type === "wrap" || (deck && bars.length >= 4)) adj = "wrap-around";
  else if (type === "courtyard" || type === "podium") adj = courts >= 2 ? "E-shaped" : bars.length === 2 ? "L-shaped" : bars.length === 3 ? "U-shaped" : "courtyard";
  else if (type === "garden" || type === "corridor-garden") adj = bars.length > 1 ? "low-bar" : "single-bar";
  else adj = bars.length > 1 ? "multi-bar" : "single-bar";
  let tall = null;
  for (const b of bars) if (!tall || nz(b.floors) > nz(tall.floors)) tall = b;
  const progWords = { residential: "residential", hotel: "hotel", senior: "senior living" };
  const prog = progWords[tall && tall.program] || "mixed-use";
  const floors = Math.round(nz(m.floors));
  const out = [`The hero building is the ${floors}-story ${adj} ${prog} building at the center of the image. ${RENDER_ONLY}`];
  out.push(`* Height is about ${feet(m.height)}.`);
  const parts = [bars.length ? plural(countWord(bars.length), "bar", "bars") : ""];
  if (courts && adj !== "wrap-around") parts.push(courts === 1 ? "a courtyard" : `${countWord(courts)} courtyards`);
  if (deck) parts.push("a parking deck inside the wrap");
  const podN = state.podium && state.podium.on ? Math.max(1, (state.podium.levels || []).length) : 0;
  if (podN) parts.push(`${articleFor(String(podN))} ${podN}-story podium`);
  out.push(`* It has ${oxford(parts.filter(Boolean))}. Keep the bars, the courtyard, and the podium exactly as the massing shows them.`);
  out.push(`* The roof is ${state.roof && state.roof.type === "screen" ? "flat with a rooftop screen" : "flat"}.`);
  return out.join("\n");
}

function heroParking(state, m) {
  const n = Math.round(nz(m.levels, nz(state.levels && state.levels.count)));
  const ramps = { "single-helix": "single helix", "double-helix": "double helix", speed: "speed", split: "split-level", "sloped-floor": "sloped-floor", none: "" };
  const ramp = state.ramp && state.ramp.type in ramps ? ramps[state.ramp.type] : "";
  const out = [`The hero building is the ${n}-level parking deck at the center of the image, with open sides${ramp ? ` and a ${ramp} ramp` : ""}. ${RENDER_ONLY}`];
  out.push(`* Height is about ${feet(m.topOfDeck)} to the top of the deck.`);
  out.push("* Each level reads as a flat slab edge with a low guard wall. The sides stay open, so cars and columns show behind the edge.");
  if (state.source === "wrap") out.push("* A building wraps the deck. Keep the wrap exactly as the massing shows it.");
  else if (state.source === "podium") out.push("* The deck is the podium under a building. Keep the building above exactly as the massing shows it.");
  if (state.liner && state.liner.on) out.push("* A retail liner runs along one side of the deck. Keep it exactly as the massing shows it.");
  return out.join("\n");
}

function heroFacade(state, d) {
  const hud = d.hud || {};
  const n = Math.round(nz(hud.levels));
  let massing;
  if (state.source === "project" && d.built && d.built.source === "project") massing = `${n}-story building from the project massing`;
  else {
    const sa = state.standalone || {};
    const shape = { rect: "rectangular", L: "L-shaped", U: "U-shaped", O: "courtyard" }[sa.shape] || "rectangular";
    massing = `${n}-story ${shape} building${sa.podium && sa.podium.on ? " on a podium" : ""}`;
  }
  const out = [`The hero building is the ${massing} at the center of the image. ${RENDER_ONLY}`];
  out.push(`* Height is about ${feet(hud.height)}.`);
  const faces = d.faces || [];
  const zones = [];
  for (const f of faces) if (f && f.zone != null && !zones.includes(f.zone)) zones.push(f.zone);
  const label = (id) => {
    const r = state.zones && Array.isArray(state.zones.ranges) ? state.zones.ranges.find((x) => x && String(x.id) === String(id)) : null;
    return r && r.name ? String(r.name) : String(id);
  };
  for (const z of zones) {
    const systems = [];
    for (const f of faces) {
      if (f.zone !== z) continue;
      const k = (f.rule && f.rule.system) || "punched";
      if (!systems.includes(k)) systems.push(k);
    }
    const zi = hud.zones && hud.zones[z];
    const glass = zi ? ` About ${Math.round(nz(zi.wwr) * 100)} percent of the wall is glass.` : "";
    out.push(`* ${label(z).charAt(0).toUpperCase()}${label(z).slice(1)} zone: ${oxford(systems.map((k) => FACADE_SYSTEMS[k] || k))}.${glass}`);
  }
  out.push(`* Overall, about ${Math.round(nz(hud.wwr) * 100)} percent of the facade is glass.`);
  out.push("* Keep every window, door, balcony, fin, and shade exactly where the model shows it.");
  return out.join("\n");
}

function heroGrading(state, d) {
  const hud = d.hud || {};
  const bs = (d.built && d.built.buildings) || [];
  const pads = Math.round(nz(hud.tierCount));
  const out = [`The hero building is the building on the graded pad at the center of the image. Show the pads, the walls, and the slopes as graded. ${RENDER_ONLY}`];
  out.push(`* ${bs.length > 1 ? `The site has ${bs.length} buildings on ${plural(pads, "pad", "pads")}.` : `The building stands on ${pads === 1 ? "one pad" : `${countWord(pads)} pads`}.`}`);
  const g = state.ground || {};
  if (g.mode === "plane" && g.plane) {
    const dir = COMPASS[Math.round((((nz(g.plane.downhill) % 360) + 360) % 360) / 45) % 8];
    out.push(`* The ground falls ${(Math.round(nz(g.plane.slope) * 10) / 10).toFixed(1)} percent toward the ${dir}.`);
  }
  if (nz(hud.wallCount) > 0) out.push(`* There ${hud.wallCount === 1 ? "is one retaining wall" : `are ${hud.wallCount} retaining walls`}, up to ${(Math.round(nz(hud.wallMax) * 10) / 10).toFixed(1)} feet tall.`);
  out.push("* Keep every slope, wall, step, and drive exactly as the model shows it.");
  return out.join("\n");
}

export function heroFor(tool, state, data) {
  try {
    const st = state || {}, dt = data || {};
    if (tool === "tower") return heroTower(st, dt);
    if (tool === "midrise") return heroMidrise(st, dt);
    if (tool === "parking") return heroParking(st, dt);
    if (tool === "facade") return heroFacade(st, dt);
    if (tool === "grading") return heroGrading(st, dt);
  } catch (e) { /* fall through */ }
  return HERO_FALLBACK;
}

export const HERO_PROMPT_ID = "hero-render";

export const PROMPTS = [
  // ---------------------------------------------------------------- hero (Cade's standard: the hero real, the context white, the ground real)
  {
    id: HERO_PROMPT_ID,
    group: "hero",
    title: "Hero render",
    description: "The hero building photoreal, the context as a white model, the ground real. Cade's standard.",
    noLock: true,
    template:
      "Edit the attached massing model image. Do not regenerate the scene from scratch.\n\n" +
      "KEEP EXACTLY AS SHOWN\n" +
      "* The camera angle, perspective, framing, and horizon line.\n" +
      "* The footprint, height, rotation, and position of every building.\n" +
      "* The road layout, block shapes, and site boundary.\n" +
      "Do not add, remove, move, stretch, or reshape any volume.\n\n" +
      "HERO BUILDING — RENDER PHOTOREAL\n" +
      "{{hero}}\n" +
      "* The facade is {{material}}.\n" +
      "* Slab edges read as dark horizontal lines between floors.\n" +
      "* Interior lights are on in most rooms, in varied warm and neutral tones. Each floor reads as its own band of light.\n\n" +
      "CONTEXT BUILDINGS — KEEP AS WHITE MODEL\n" +
      "Render every other building as an opaque matte white volume.\n" +
      "* No windows. No glazing. No texture. No signage. No material.\n" +
      "* Keep crisp clean edges and soft grey shadows.\n" +
      "* The context must read as a physical white study model.\n\n" +
      "GROUND PLANE — RENDER PHOTOREAL\n" +
      "Render the ground and everything on it with real materials.\n" +
      "* Asphalt roads with lane markings and crosswalks. Concrete sidewalks and curbs.\n" +
      "* Parked and moving cars. Street trees {{season}}. Pedestrians at small scale. Streetlights on after dusk.\n" +
      "* Keep every road, walk, tree, and water area where the model shows it.\n\n" +
      "RULE\n" +
      "Vertical building volumes stay matte white. The ground plane and the objects on it become real. The hero building is the only building that becomes real.\n\n" +
      "LIGHT AND SKY\n" +
      "The scene is photographed {{time}}. The white volumes catch the color of the sky. The hero building reads warm against them.\n\n" +
      "CAMERA\n" +
      "Architectural visualization quality. Vertical lines stay straight. Clean blacks. Sharp focus across the frame.\n\n" +
      "DO NOT INCLUDE\n" +
      "Text, logos, watermarks, building signage, neon colors, fisheye distortion, tilt-shift blur, cartoon or illustration style, windows on the white volumes.",
    uses: ["material", "time", "season"],
    defaults: { material: FRITTED, time: DUSK, season: AUTUMN },
  },

  // ---------------------------------------------------------------- time / weather
  {
    id: "time-golden-hour",
    group: "time",
    title: "Golden hour",
    description: "Warm low sun from the side, long shadows, and glowing glass.",
    template:
      `${OPEN}, in late-afternoon golden hour light. ` +
      "Low warm sun rakes across one face and leaves the other in cool shade, so each floor line and setback reads crisply. " +
      "The facade is {{material}}; sunlit glass carries warm sky reflections. " +
      "The setting is {{location}}, {{season}}. " +
      "Long soft shadows cross the street, with people walking and parked cars for scale. " +
      "Full-frame camera, sharp prime lens, natural color.\n" +
      `Avoid: ${AVOID_BASE}, lens flare streaks, oversaturated orange, ${AVOID_END}`,
    uses: ["material", "location", "season"],
    defaults: {},
  },
  {
    id: "time-overcast-midday",
    group: "time",
    title: "Overcast midday",
    description: "Soft, even daylight that shows true material color and texture.",
    template:
      `${OPEN}, under a bright overcast midday sky. ` +
      "Soft, nearly shadowless light shows the true color and texture of the facade, which is {{material}}. " +
      "Glass reads pale gray with faint cloud reflections, and slab edges stay legible floor by floor. " +
      "The setting is {{location}}, {{season}}. " +
      "Pedestrians, cyclists, and a few cars show true scale. " +
      "Neutral white balance, even exposure, documentary realism like a published project photo.\n" +
      `Avoid: ${AVOID_BASE}, dramatic HDR, heavy vignetting, ${AVOID_END}`,
    uses: ["material", "location", "season"],
    defaults: {},
  },
  {
    id: "time-blue-hour",
    group: "time",
    title: "Blue hour dusk",
    description: "Deep blue sky just after sunset with warm interior lights coming on.",
    template:
      `${OPEN}, in the blue hour twenty minutes after sunset. ` +
      "The sky is deep cobalt with a faint warm glow at the horizon. " +
      "About half the rooms glow with warm 3000 K light that shows ceilings and the window rhythm; the rest stay dark. " +
      "The facade is {{material}}. The lobby glows at street level, with soft car light trails and people on the sidewalk. " +
      "The setting is {{location}}, {{season}}. Tripod long exposure, low noise.\n" +
      `Avoid: ${AVOID_BASE}, starburst flares, neon colors, ${AVOID_END}`,
    uses: ["material", "location", "season"],
    defaults: {},
  },
  {
    id: "time-night-lit",
    group: "time",
    title: "Night, lit interiors",
    description: "Dark sky with most rooms lit, so each floor reads as a glowing band.",
    template:
      `Night ${OPEN.charAt(0).toLowerCase() + OPEN.slice(1)}, against a dark sky with a faint city glow. ` +
      "Most rooms are lit in varied warm and neutral tones, some with blinds half drawn, so each floor reads as its own band of light. " +
      "The facade is {{material}}; slab edges show as dark lines between lit floors. " +
      "The crown is softly washed with light. Streetlights, lit storefronts, and headlight trails define the street. " +
      "The setting is {{location}}, {{season}}. Tripod long exposure, clean blacks.\n" +
      `Avoid: ${AVOID_BASE}, signs on the building, neon colors, ${AVOID_END}`,
    uses: ["material", "location", "season"],
    defaults: { season: "in winter with bare trees and dry pavement, no snow" },
  },
  {
    id: "time-after-rain",
    group: "time",
    title: "After rain",
    description: "Wet pavement with sharp reflections of the tower as the sky clears.",
    template:
      `${OPEN}, just after a rain shower. ` +
      "The sky is clearing, with bright gaps behind moving gray clouds. " +
      "Streets and plaza paving are wet and dark, with sharp reflections of the tower and lit storefronts in shallow puddles. " +
      "The facade is {{material}}, slightly darkened and glistening. " +
      "Pedestrians carry umbrellas, and passing cars throw a light spray. " +
      "The setting is {{location}}. Rich contrast, true color, sharp full-frame detail.\n" +
      `Avoid: ${AVOID_BASE}, heavy falling rain, fog hiding the building, ${AVOID_END}`,
    uses: ["material", "location"],
    defaults: {},
  },

  // ---------------------------------------------------------------- facade material
  {
    id: "material-glass-curtain-wall",
    group: "material",
    title: "Glass curtain wall",
    description: "Unitized glass with slim mullions and a spandrel band at every floor.",
    template:
      `${OPEN}. ` +
      "Clad it in a unitized glass curtain wall: slim aluminum mullions at 5-foot spacing, low-iron vision glass with a light neutral tint, " +
      "and an opaque shadow-box spandrel at every slab edge, so the floor count stays exact. " +
      "Reflections show sky and neighbors with slight panel-to-panel variation. " +
      "The ground floor has clear storefront glazing. " +
      "The setting is {{location}}, photographed {{time}}, {{season}}. People and street trees at true scale.\n" +
      `Avoid: ${AVOID_BASE}, mirror-chrome glass, warped reflections, ${AVOID_END}`,
    uses: ["location", "time", "season"],
    defaults: {},
  },
  {
    id: "material-precast-punched",
    group: "material",
    title: "Precast, punched windows",
    description: "Light gray precast panels with a regular grid of recessed windows.",
    template:
      `${OPEN}. ` +
      "The facade is light warm-gray acid-etched precast concrete in floor-high panels with fine, even joints. " +
      "Punched windows sit in a regular grid, recessed 8 inches, with dark bronze frames, one row per floor. " +
      "The concrete shows subtle tonal variation, not stains. Larger openings at street level hold storefronts and the lobby. " +
      "The setting is {{location}}, photographed {{time}}, {{season}}. " +
      "Pedestrians and cars for scale; the recesses cast clear shadows.\n" +
      `Avoid: ${AVOID_BASE}, board-formed brutalist texture, grime, ${AVOID_END}`,
    uses: ["location", "time", "season"],
    defaults: { time: "in clear late-morning sun under a deep blue sky" },
  },
  {
    id: "material-terracotta",
    group: "material",
    title: "Terracotta fins",
    description: "Glass screened by vertical terracotta baguettes in a warm clay color.",
    template:
      `${OPEN}. ` +
      "The facade is clear glazing screened by vertical terracotta baguettes in a warm clay color, 2 inches wide and 12 inches apart, " +
      "with slight glaze variation from piece to piece. " +
      "The baguettes stop at a thin metal band at every slab edge, keeping each floor line visible, and cast fine vertical shade lines. " +
      "The setting is {{location}}, photographed {{time}}, {{season}}. " +
      "Planting and people at street level for scale.\n" +
      `Avoid: ${AVOID_BASE}, plastic-looking fins, brick texture, ${AVOID_END}`,
    uses: ["location", "time", "season"],
    defaults: {},
  },
  {
    id: "material-metal-panel",
    group: "material",
    title: "Ribbed metal panel",
    description: "Bands of glass and ribbed, partly perforated champagne aluminum panels.",
    template:
      `${OPEN}. ` +
      "The facade alternates horizontal bands of glazing with ribbed anodized aluminum panels in a soft champagne tone. " +
      "Fine vertical ribs catch the light differently on each face, and over the spandrels a perforated pattern turns slightly translucent. " +
      "Each glass and panel band aligns with a floor, with tight, precise joints. " +
      "The setting is {{location}}, photographed {{time}}, {{season}}. " +
      "Street trees and people for scale; satin metal sheen.\n" +
      `Avoid: ${AVOID_BASE}, corrugated industrial siding, rust, ${AVOID_END}`,
    uses: ["location", "time", "season"],
    defaults: {},
  },
  {
    id: "material-brick",
    group: "material",
    title: "Brick, deep reveals",
    description: "Warm red-brown brick with tall windows set in deep reveals.",
    template:
      `${OPEN}. ` +
      "The facade is warm red-brown brick in running bond, with tight mortar joints and a natural color range. " +
      "Tall windows sit in deep 12-inch reveals with dark metal frames, one row per floor, and a slim precast band marks each floor line. " +
      "The ground floor has larger steel-framed storefronts. " +
      "The setting is {{location}}, photographed {{time}}, {{season}}. " +
      "Pedestrians, bikes, and street trees for scale; brick texture visible near the street.\n" +
      `Avoid: ${AVOID_BASE}, painted brick, ivy on the facade, ${AVOID_END}`,
    uses: ["location", "time", "season"],
    defaults: { location: "a Midwest river city with brick warehouses and steel bridges" },
  },
  {
    id: "material-mass-timber",
    group: "material",
    title: "Mass timber and glass",
    description: "Full-height glass that shows a warm exposed timber structure inside.",
    template:
      `${OPEN}. ` +
      "The facade is floor-to-ceiling glass in slim dark frames, revealing the exposed mass timber structure inside: " +
      "glulam columns and beams and cross-laminated timber ceilings in warm honey tones on every floor. " +
      "Thin bronze slab edges mark each floor line, and the clear glass shows the wood behind soft sky reflections. " +
      "The setting is {{location}}, photographed {{time}}, {{season}}. " +
      "Planters and people at the base for scale.\n" +
      `Avoid: ${AVOID_BASE}, log-cabin look, exterior wood siding, ${AVOID_END}`,
    uses: ["location", "time", "season"],
    defaults: {
      location: "a Pacific Northwest city with tall evergreens and nearby hills",
      time: "in the blue hour just after sunset with interior lights coming on",
    },
  },

  // ---------------------------------------------------------------- site context
  {
    id: "context-downtown",
    group: "context",
    title: "Dense downtown",
    description: "A tight downtown block with busy streets and a deep skyline behind.",
    template:
      `${OPEN}, on a tight block in a large US downtown. ` +
      "Render the light-gray blocks as existing buildings of mixed ages, older stone and brick beside newer glass. " +
      "Far behind them, a dense skyline fades into mild haze. " +
      "Streets have crosswalks, traffic signals, taxis, buses, and busy sidewalks with people at true scale. " +
      "The facade is {{material}}. Photographed {{time}}, {{season}}. Sharp foreground detail.\n" +
      `Avoid: ${AVOID_BASE}, billboards, new buildings in front of the tower, ${AVOID_END}`,
    uses: ["material", "time", "season"],
    defaults: {},
  },
  {
    id: "context-waterfront",
    group: "context",
    title: "Waterfront promenade",
    description: "A public promenade and seawall with calm water reflecting the tower.",
    template:
      `${OPEN}, on a city waterfront. ` +
      "Calm water fills the open foreground where no blocks stand, with soft ripples and a broken reflection of the tower. " +
      "A wide promenade runs along a seawall, with benches, light poles, and shade trees. " +
      "Joggers, cyclists, and strollers set the scale, and a few small boats sit offshore. " +
      "Render the light-gray blocks as neighboring buildings along the shore. " +
      "The facade is {{material}}. Photographed {{time}}, {{season}}. Clean, airy atmosphere.\n" +
      `Avoid: ${AVOID_BASE}, cruise ships, beach resort look, ${AVOID_END}`,
    uses: ["material", "time", "season"],
    defaults: { season: "in a mild Southern winter with evergreen trees and green lawns" },
  },
  {
    id: "context-suburban-edge",
    group: "context",
    title: "Suburban edge",
    description: "The tower rises alone above low-rise suburban neighbors and parking.",
    template:
      `${OPEN}, at the edge of a suburban town center. ` +
      "Render the light-gray blocks, at their exact size, as suburban neighbors such as garden apartments, a small office building, and shops. " +
      "Around them are surface parking lots, a wide arterial road, young street trees, and a stormwater pond with native planting. " +
      "The tower clearly rises above everything nearby. " +
      "The facade is {{material}}. Photographed {{time}}, {{season}}. Cars, cyclists, and a few people for scale.\n" +
      `Avoid: ${AVOID_BASE}, other high-rises, billboards, ${AVOID_END}`,
    uses: ["material", "time", "season"],
    defaults: {},
  },
  {
    id: "context-park-edge",
    group: "context",
    title: "Park edge",
    description: "Mature trees and a lawn in front, framing the base of the tower.",
    template:
      `${OPEN}, facing a large city park. ` +
      "Mature oaks and plane trees, 50 to 70 feet tall, stand in the open ground in front, " +
      "and a curving path leads toward the base, with people walking, sitting on the lawn, and walking dogs. " +
      "The trees frame the lower floors but leave the floor lines and crown clearly visible. " +
      "Render the light-gray blocks as neighboring buildings along the park edge. " +
      "The facade is {{material}}. Photographed {{time}}, {{season}}.\n" +
      `Avoid: ${AVOID_BASE}, trees hiding the tower, fantasy landscaping, ${AVOID_END}`,
    uses: ["material", "time", "season"],
    defaults: { season: "in autumn with orange, red, and gold foliage" },
  },
  {
    id: "context-main-street",
    group: "context",
    title: "Mixed-use main street",
    description: "A walkable main street with cafes, shops, and outdoor tables at the base.",
    template:
      `${OPEN}, on a walkable mixed-use main street. ` +
      "The ground floor holds cafes and shops with awnings, outdoor tables, and planters along a wide sidewalk with street trees. " +
      "Render the light-gray blocks as neighboring buildings with varied storefronts. " +
      "Parallel-parked cars, a bike lane, and people strolling and dining set the scale. " +
      "The facade is {{material}}. Photographed {{time}}, {{season}}. Lively but uncluttered, true color.\n" +
      `Avoid: ${AVOID_BASE}, readable store signs, crowds hiding the base, ${AVOID_END}`,
    uses: ["material", "time", "season"],
    defaults: { season: "in spring with fresh light-green leaves and a few flowering trees" },
  },

  // ---------------------------------------------------------------- camera
  {
    id: "camera-aerial-300m",
    group: "camera",
    title: "Aerial, 300 m",
    description: "Drone view from about 300 m. Export the model from a high three-quarter angle first.",
    template:
      "Aerial drone photograph of this {{program}} tower, about {{height}} tall with {{podium}}, " +
      "taken from about 300 m away at a high three-quarter angle that matches the image. " +
      "Visible roofs get realistic membrane, pavers, or planting, with no new rooftop structures. " +
      "Streets, rooftops, trees, and cars spread around the site at true scale, and the light-gray blocks get real roofs. " +
      "The facade is {{material}}. The setting is {{location}}, photographed {{time}}, {{season}}. " +
      "Light haze toward the horizon.\n" +
      `Avoid: ${AVOID_BASE}, tilt-shift miniature blur, ${AVOID_END}`,
    uses: ["material", "location", "time", "season"],
    defaults: { time: "in clear late-morning sun under a deep blue sky" },
  },
  {
    id: "camera-street-24mm",
    group: "camera",
    title: "Across the street",
    description: "Street-level view from across the street with a 24 mm lens. Set a low, level view first.",
    template:
      "Street-level photograph of this {{program}} tower, about {{height}} tall with {{podium}}, " +
      "taken from the far sidewalk with a 24 mm lens at eye height, as in the image. " +
      "The base fills the lower frame and the tower rises in natural perspective to the crown, with vertical lines kept straight. " +
      "The near street has crosswalk stripes, a passing car, and people mid-stride with slight motion blur. " +
      "The facade is {{material}}. The setting is {{location}}, photographed {{time}}, {{season}}. Full-frame camera at f/8.\n" +
      `Avoid: ${AVOID_BASE}, leaning or bent verticals, ${AVOID_END}`,
    uses: ["material", "location", "time", "season"],
    defaults: {},
  },
  {
    id: "camera-base-closeup",
    group: "camera",
    title: "Base close-up",
    description: "Eye-level close-up of the entry and lower floors. Zoom the model in on the base first.",
    template:
      "Pedestrian eye-level photograph of the base of this {{program}} tower, with {{podium}}, " +
      "taken from about 15 m away with a 35 mm lens and cropped as in the image. " +
      "It shows the entrance, lobby glazing, and the lower floors above in high detail: " +
      "mullion caps, door pulls, paving joints, bollards, planters, and lobby furniture behind clean glass. " +
      "People enter and pass by at true scale. " +
      "The facade is {{material}}. The setting is {{location}}, photographed {{time}}, {{season}}.\n" +
      `Avoid: ${AVOID_BASE}, readable signage, ${AVOID_END}`,
    uses: ["material", "location", "time", "season"],
    defaults: { time: "in clear late-morning sun under a deep blue sky" },
  },
  {
    id: "camera-skyline-2km",
    group: "camera",
    title: "Distant skyline",
    description: "Telephoto skyline view from about 2 km. Zoom the model far out first.",
    template:
      "Telephoto photograph of this {{program}} tower, about {{height}} tall, seen in the skyline from about 2 km away with a 200 mm lens, as in the image. " +
      "It keeps its exact silhouette and crown and reads as a clear landmark. " +
      "The light-gray blocks become neighboring buildings, and lower-contrast existing buildings fill the skyline beside and behind the tower, never in front of it. " +
      "Light haze softens the distance. The facade is {{material}}, with floor lines still readable. " +
      "The setting is {{location}}, photographed {{time}}, {{season}}.\n" +
      `Avoid: ${AVOID_BASE}, buildings blocking the tower, ${AVOID_END}`,
    uses: ["material", "location", "time", "season"],
    defaults: { time: "in late-afternoon golden hour light with low warm sun raking across the facade" },
  },
];

// Full prompt text: FORM_LOCK + blank line + template, with every {{token}} replaced.
// A prompt with noLock: true (the Hero render) starts with its own text, without the form lock.
// Value order (later wins): PROMPT_FIELDS defaults < prompt.defaults < values.
// {{hero}} has a plain default sentence, so a tool that does not send it still gets a whole prompt.
// Empty, null, or undefined entries in values do not override a default.
// Unknown tokens stay visible as [token].
export function fillPrompt(prompt, values = {}) {
  const merged = { hero: HERO_FALLBACK };
  for (const [key, field] of Object.entries(PROMPT_FIELDS)) merged[key] = field.default;
  for (const [key, v] of Object.entries((prompt && prompt.defaults) || {})) {
    if (v !== undefined && v !== null && v !== "") merged[key] = v;
  }
  for (const [key, v] of Object.entries(values || {})) {
    if (v !== undefined && v !== null && v !== "") merged[key] = v;
  }
  const text = (prompt && prompt.noLock ? "" : FORM_LOCK + "\n\n") + ((prompt && prompt.template) || "");
  return text
    .replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) =>
      Object.prototype.hasOwnProperty.call(merged, key) ? String(merged[key]) : `[${key}]`)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .trim();
}
