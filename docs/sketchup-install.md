# CMRLM Design Tools for SketchUp: Install and Use

For: Cade. Software: SketchUp Pro 2021 or later, on the Mac.
Not supported: SketchUp for Web.

The extension reads a `.sketchup.json` file. The Tower Generator and the Site Model make these files. The extension builds SketchUp groups, solids, terrain, tags, and materials from the file. The whole import is one undo step.

---

## 1. Get the extension file

**WARNING: Do not unzip the `.rbz` file. SketchUp needs the `.rbz` file as it is.**

**WARNING: Do not download the whole repository. You only need one file.**

1. Open the design-tools repository on GitHub.
2. Open the folder `dist`.
3. Click `cmrlm-design-tools.rbz`.
4. Click the **Download raw file** button (the arrow that points down, at the top right of the file view).
5. Find the file in your Downloads folder.
6. Make sure the file name ends in `.rbz`. If Safari added `.zip`, rename the file and remove `.zip`.

---

## 2. Set the loading policy

SketchUp checks every extension when it starts. This extension has no Trimble signature. SketchUp calls it an *unidentified* extension. The loading policy tells SketchUp what to do with it.

**CAUTION: Change this setting before you install. If you do not, SketchUp can install the extension but refuse to load it.**

The three settings are:

| Setting | What it means | Use it? |
|---|---|---|
| Identified Extensions Only | SketchUp loads only signed extensions. It blocks this extension. | No. |
| Approve Unidentified Extensions | SketchUp loads signed extensions. For an unsigned extension, SketchUp asks you first. You choose Yes or No. | **Yes. This is the safest setting that works.** |
| Unrestricted | SketchUp loads every extension. It does not ask. | No. Use it only if the other setting fails. |

To set the policy:

1. In SketchUp, click **Extensions > Extension Manager**.
2. Click the **gear icon** (Settings) in the Extension Manager window.
3. Click **Loading Policy**.
4. Click **Approve Unidentified Extensions**.
5. Close the settings.

---

## 3. Install the extension

1. In SketchUp, click **Extensions > Extension Manager**.
2. Click **Install Extension**.
3. Select `cmrlm-design-tools.rbz`.
4. Click **Open**.
5. If SketchUp asks whether to install an unsigned extension, click **Yes**.
6. If SketchUp asks whether to load "CMRLM Design Tools", click **Yes**.
7. Quit SketchUp. Start SketchUp again. This step is always safe. It is required if the menu does not show.

Check the install. The menu **Extensions > CMRLM > Import Design Tools file…** must show. Also, **CMRLM Design Tools** must show in the Extension Manager with a version number and the switch on.

---

## 4. Import a file

1. Export a file from the Tower Generator or the Site Model. Use the SketchUp export. The file name ends in `.sketchup.json`.
2. Open a SketchUp model. A new, empty model gives the cleanest result.
3. Click **Extensions > CMRLM > Import Design Tools file…**.
4. Select the `.sketchup.json` file.
5. Click **Open**.
6. Wait. A large site can take about 30 seconds or more. SketchUp can look frozen. Do not click in the model.
7. Read the status bar at the bottom left. It shows a message such as `Imported 412 groups from Option A`.

SketchUp zooms to the new model.

**To undo the import:** click **Edit > Undo**. One click removes the whole import.

**If the file is wrong:** SketchUp shows a message in plain words. The model does not change. The cause is usually one of these:

- The file is not a Design Tools file.
- The file version is newer than the extension. Install the newest extension.
- The file is damaged. Export it again.

---

## 5. What the model looks like

The import makes one root group at the model origin. The root group has the name of the option or the site.

**Groups.** Every part of the design is a named group. Open a group to see the parts in it.

- *Tower:* the root group holds `Podium`, `Segment …`, `Crown`, and `Context`. Each floor is a closed solid group.
- *Site:* the root group holds `Ground`, `Buildings`, `Roads`, `Road centerlines`, `Water`, and `Site boundary`.

**Solids.** Floors and buildings are closed solid groups. Select one and look at Entity Info. It shows a volume. A solid that is not closed has the attribute `manifold = false` and shows no volume. This happens rarely.

**Terrain.** The `Ground` group is a mesh of triangles. The inside edges are soft and smooth. The outer edges are hard. The Sandbox tools work on it.

**Tags.** The import makes one tag for each kind of part, for example `Residential`, `Buildings`, `Roads`, and `Ground`. A tag is on a group. The loose edges and faces inside a group have no tag. This is correct. Do not change it.

- Open the Tags panel: **Window > Default Tray > Tags**.
- Click the eye next to a tag to hide it or show it.
- The tag `Road centerlines` is hidden after the import. Click its eye to show the lines.

**Materials.** Each material has a color. Water is partly transparent. The material is on the group. The faces inside use the material of the group.

**Attributes.** Every group can hold extra data. The data is in a dictionary named `cmrlm`. SketchUp has no panel that shows this dictionary. Read it in the Ruby Console. Select a group. Click **Window > Ruby Console**. Type this line and press **Return**:

```ruby
Sketchup.active_model.selection.first.attribute_dictionary("cmrlm").each_pair { |k, v| puts "#{k} = #{v}" }
```

Buildings keep `height_ft`, `height_source`, and `overture_id`. Floors keep `floor`, `program`, and `area_sf`. The root group keeps `zShift`, `source`, `name`, and `createdAt`.

**Location.** A site file sets the geo-location of the model. Check it in **Window > Model Info > Geo-location**. Shadows use the real place. A tower file does not set a location.

**Re-import.** If you import a second file, the extension re-uses tags and materials that have the same name. The colors and the visibility from the new file replace the old ones.

---

## 6. Return to true elevations (site files)

The Site Model moves the site down. The lowest point of the ground is at 0 ft. This keeps SketchUp fast and accurate. The shift value is named `zShift`. It is a negative number, for example `-1012.4`.

The notes of the site export say it too: "SketchUp: add N ft to return to NAVD88".

**WARNING: Move the root group only. Do not move the groups inside it. Moving the root keeps all parts in line.**

To move the model to true elevations:

1. Click the root group once to select it.
2. Click the **Move** tool.
3. Click any point on the group.
4. Press the **Up arrow** key. This locks the move to the blue axis.
5. Move the mouse up a little.
6. Type the shift value without a minus sign, followed by a foot mark. Example: `1012.4'`
7. Press **Return**.

To read the shift value from the model:

1. Click **Window > Ruby Console**.
2. Type this line and press **Return**:

```ruby
Sketchup.active_model.get_attribute("cmrlm", "zShift")
```

The console shows the number.

To move the root group with one command, type these lines in the Ruby Console. The move is one undo step.

```ruby
m = Sketchup.active_model
g = m.entities.grep(Sketchup::Group).find { |x| x.get_attribute("cmrlm", "zShift") }
m.start_operation("Return to true elevations", true)
g.transform!(Geom::Transformation.new([0, 0, -g.get_attribute("cmrlm", "zShift").to_f * 12]))
m.commit_operation
```

---

## 7. If faces were skipped

Sometimes SketchUp cannot build a face. The usual causes are two points that are almost the same, or a polygon that is not flat. The extension skips that face and continues. It does not stop the import.

At the end, SketchUp shows a message such as `4 faces skipped`. The status bar shows the same number in brackets.

The rest of the model is correct. A few skipped faces on a large site are normal.

If faces were skipped:

1. Look for small gaps in the ground, in roads, or in the top of a building.
2. Fill a gap by hand. Click the **Line** tool. Trace one edge of the gap. SketchUp makes the face.
3. If a whole building is missing, import the file again after you re-export it. A small change to the design often removes the problem.
4. If many faces are skipped each time, send the `.sketchup.json` file to the person who maintains the tools.

**CAUTION: A solid that failed is not in the model. The skipped count includes it.**

---

## 8. If something does not work

| Problem | What to do |
|---|---|
| The menu **CMRLM** does not show. | Open **Extensions > Extension Manager**. Make sure **CMRLM Design Tools** is on. Check the loading policy (section 2). Restart SketchUp. |
| SketchUp says the extension did not load. | Open **Window > Ruby Console**. Read the red text. Send it to the person who maintains the tools. |
| The import is slow. | Wait. Large sites take longer. Close other large models first. |
| The file dialog does not show your file. | Select **All Files** in the dialog, or rename the file so it ends in `.sketchup.json`. |
| A message says the import stopped. | SketchUp undid the import. The model is unchanged. Send the message to the person who maintains the tools. |

---

## 9. Update the extension

1. Download the new `cmrlm-design-tools.rbz` from the repository (section 1).
2. Click **Extensions > Extension Manager > Install Extension**.
3. Select the new file.
4. If SketchUp asks whether to replace the old version, click **Yes**.
5. Quit SketchUp. Start SketchUp again.
6. Open the Extension Manager. Check that the version number is the new one.

To remove the extension:

1. Click **Extensions > Extension Manager**.
2. Find **CMRLM Design Tools**.
3. Click **Uninstall**.
4. Quit SketchUp. Start SketchUp again.
