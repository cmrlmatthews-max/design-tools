# Site Model — Tampa Comparison with site3d

Date: October 21, 2026
Site: 3615 West Cypress Street, Tampa, FL. Same 2,900 ft square as the site3d project `tampa-cypress`.
Method: the Site Model modules ran on data downloaded on October 21, 2026. The results were compared with the site3d outputs in state plane feet (EPSG:6443).

## 1. Result

| Item | Target | Result | Status |
|---|---|---|---|
| Ground elevation | ±3 ft | 94.2% of 9,703 grid points within 3 ft. Median difference 0.40 ft. Mean −0.26 ft. | Met |
| Building position | ±10 ft | 95% of matched buildings within 10 ft (centroid). Median 1.7 ft. Median footprint overlap (IoU) 0.84. | Met |
| Building height | ±12 ft (1 floor) | 72% of matched buildings within 12 ft. | Close. See section 3. |
| Building count | — | 447 in Site Model, 523 in site3d. 423 match (81% of site3d). | See section 4. |

The 75% target is met for ground and positions. Heights are just under the target, but the reference itself is weak (section 3).

## 2. Ground

- Site Model uses the USGS 3DEP elevation service. At this site the service gives the 1/3 arc-second DEM (about 10 m). site3d uses 2007 LiDAR (72%) and the same DEM (28%).
- 561 points differ by more than 3 ft, and 279 by more than 6 ft. These are small areas where the LiDAR shows detail that the 10 m DEM does not show, for example pond banks and ditches.
- For massing and site context this is acceptable. For grading work, use site3d.

## 3. Building heights

| Height source (Site Model / site3d) | Count | Within 12 ft |
|---|---|---|
| Overture height / Overture height | 251 | 100% |
| Overture height / 2007 LiDAR | 165 | 30% |
| Estimate / estimate | 4 | 75% |

- When both tools use Overture heights, the result is the same.
- When site3d uses LiDAR, the two tools differ in both directions. The LiDAR is from 2007. Many buildings at Westshore are newer than that. Thus the comparison cannot show which height is correct.
- One building has 18 floors in Overture (216 ft) and 44 ft in the 2007 LiDAR. It is possibly a newer tower. Check it against Google Maps.

**Recommendation:** check a few tall buildings by eye in Google Maps 3D view. This is the "basis of design" check.

## 4. Building count

- 100 site3d buildings have no match. Most are small (median 1,844 sq ft). Together they are 14% of the site3d building area.
- Causes: footprints that are only in the City of Tampa data, and buildings that are not in Overture.
- 24 Site Model buildings have no site3d match. These are likely newer buildings.

## 5. Speed

On the test fixtures: model build about 0.2 s and exports about 0.2 s for the 2,900 ft site. In a browser with local data, the full run takes about 0.5 s. With live data, network time controls the total.

## 6. Limits

- No LiDAR. The ground is only as good as the 3DEP service at the site.
- Overture heights are not checked against any survey.
- Roads use standard widths when Overture has no width.
- The Tampa square has no tree points in Overture, so trees were only tested on synthetic data.
