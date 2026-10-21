# Integration notes (Opus orchestrator)

Decisions the integrator must apply. They override any conflicting module default.

## Conventions
1. **unitFactor:** store as a fraction (0.85), `null` for programs without units. Convert the shell CONFIG and default state from percent to fraction. The UI shows it as a percent.
2. **Flat crown:** a flat crown adds the 4 ft parapet ring only, and adds 0 to total height. `crown.height` applies to the other crown types. Default crown in the shell: flat.
3. **Floor count:** podium + tower + mechanical. The crown is not a floor.
4. **tolerancePct:** a percent (0.01 means 0.01%).
5. **Floor grouping text:** use one helper everywhere (geometry `groupFloors`). Envelope `describeFloors` must give the same text; pick one and reuse it.
6. **Envelope boundary:** a plate that touches the allowed footprint exactly is inside (1 sf threshold in envelope.js). Tampa preset tests this.

## Preset and test data notes
- Presets keep a default context block that can sit outside small sites. Integrator: replace each preset's context with the "Surround" set for that site.
- L-shape key: `{ type: "L", w, d, arm }`. Confirm against geometry.js.

## From the geometry agent (apply all)
1. Remove the shell's versions of ringArea, polygonsArea, rectRing, floorRangesText, buildFloorList, baseShapeRing, TOWER_TRANSFORMS, towerPolygons, podiumPolygons, buildPlates, crownExtraHeight, computeMetrics. Use geometry.js. Keep sitePolygon, siteArea, computeBounds.
2. Map warnings: level = severity, text = message (or change the warnings list to read the contract fields).
3. Derived cache: buildPlates(s) full quality for metrics + solids; buildPlates(s, {quality:"draft"}) for drawing while a slider drags. Pass plates + solids to checkEnvelope and use its plate copies.
4. Skip void plates (plate.void or empty polygons) when extruding.
5. New plate fields: coreRect, void, t. New metrics: see geometry.js computeMetrics (floorCount excludes voids, levelCount includes them, siteCoverage is a fraction, byProgram, target.gfa/target.far, efficiencyAvg, netArea, voidFloors).
6. Load clipper-lib 6.4.2 as a classic script before the module.
7. Use groupFloors everywhere; drop envelope describeFloors use in UI text if they differ.

## Rule choices to expose in the UI (help text)
- Full carve = sky gap: floors keep height, add no area.
- Cut = plane from 0 at startFloor to `depth` at endFloor on the chosen side; `angle` is not used — hide the angle control.
- L: arms on front and left. U: open to the back. Triangle: base on the front.
