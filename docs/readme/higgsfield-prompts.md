# Image prompts for Evalbench (not generated yet)

Written for the portfolio HQ to batch into one priced plan. Nothing here has been generated, and nothing in the README depends on it: every visual renders today from real captures and code (`web/scripts/readme-visuals.mjs`). These images would only add what code cannot draw. None of them may show a screen, a number or a chart as if it were real output.

**Identity, for every prompt below.** One idea: *a blind tasting for models: no labels, just judgement.* Motif: face-down A/B tasting cards, a judge's scorecard, a red pencil tick. Palette (60/30/10): chalk `#f1eee6` field, ink `#16171b`, and spent sparingly, azure `#2563eb` for the face-down side of a card and scorecard red `#d23c2a` for marks. Type in the product: Schibsted Grotesk and Zilla Slab (no type is generated in images; letters A and B are drawn as shapes). Voice: fair, sharp.

---

## 1. Product mark

- **Use:** app icon, favicon, social preview corner, GitHub avatar for the repo card.
- **Model and why:** the `brand-asset-creation` workflow, because the mark has to hold up at 16 px and as a flat vector-style asset. HQ to confirm the model it routes to.
- **Idea:** two playing-card-sized tasting cards, one still face down, one turned over and ticked by the judge.

**Prompt (slot order: subject, composition, shape language, colour, finish, constraints):**

> Subject: a minimal app icon of two small rectangular cards with rounded corners, side by side and slightly fanned. The left card lies face down and is solid azure blue (#2563eb). The right card is turned face up, chalk white (#f1eee6), with one confident red pencil tick (#d23c2a) across its centre.
> Composition: both cards centred on a rounded-square tile of near-black ink (#16171b); the left card tilted about 11 degrees left, the right card tilted about 8 degrees right and overlapping the left one slightly; generous margin around the pair.
> Shape language: flat, geometric, crisp edges, the tick drawn as a single hand-made stroke with rounded ends, slightly uneven like a real pencil mark.
> Colour: exactly three colours plus the tile: azure, chalk, red on ink. No gradients.
> Finish: flat vector look, no texture, no shadow except a hairline separation between the overlapping cards.
> Constraints: must read at 16x16 pixels; no letters, no numbers, no gavel, no scales of justice, no robot, no sparkles, no 3D, no glossy highlights, no purple.

**References:** the current hand-built SVG mark in `web/public/favicon.svg` (same idea, to be refined, not replaced with a new concept); railway pictograms for clarity.

---

## 2. Signature hero: the judging table

- **Use:** the background plate of the README hero and the social preview, behind the real rate screen and the real scorecard (both stay composited from captures).
- **Model and why:** Higgsfield Soul (`soul_2`), photographic, prompt-only, because the plate needs real paper, real pencil graphite and natural light, which is where Soul is strongest.
- **Idea:** seen from above, the table where a blind tasting is being judged, with the names still hidden.

**Prompt:**

> Subject: an overhead photograph of a judging table covered in heavy chalk-white paper (#f1eee6). Two face-down tasting cards lie on the right side, their backs printed solid azure blue (#2563eb), one card marked with a large slab-serif capital A shape and the other with B, both printed small in chalk white. Beside them, a judge's scorecard on cream paper with thin ruled lines and three red pencil ticks (#d23c2a), and a red pencil lying diagonally across the corner of the card.
> Composition: strict top-down, flat lay; all objects in the right 45 percent of the frame; the left 55 percent is clean, empty paper for a headline; the cards slightly askew as if just placed; nothing touches the frame edges except the pencil.
> Light: soft north-window daylight from the upper left, long gentle shadows, true-to-life paper grain, no vignette.
> Camera: 50 mm, f/8, everything in focus, neutral white balance.
> Colour: chalk paper dominates, ink-black text on the scorecard, azure only on the card backs, red only on the ticks and pencil.
> Constraints: no hands, no people, no screens, no laptops, no wine glasses, no gavel, no legible words other than A and B, no logos, no extra props, no bokeh, no film grain, no purple or teal cast.

**References:** Kinfolk and Monocle flat lays for restraint; Criterion Collection covers for a single strong idea.

---

## 3. Staging surface: chalk paper

- **Use:** the surface the real screens sit on in every feature scene (replacing the flat chalk fill), so the shadows fall on something physical.
- **Model and why:** Higgsfield Soul (`soul_2`), for a believable paper surface at high resolution; it tiles under the composited captures.
- **Idea:** the same paper as the judging table, close up, with nothing on it.

**Prompt:**

> Subject: a seamless, evenly lit close-up of heavy chalk-white drawing paper (#f1eee6) with a fine, natural tooth.
> Composition: perfectly flat and frontal, uniform across the frame so it can tile; no objects, no creases, no edges.
> Light: soft, even daylight with no hotspots and no shadow gradient.
> Finish: subtle grain visible at 100 percent, invisible at thumbnail size.
> Constraints: no pattern, no grid, no dots, no stains, no vignette, no colour cast, no text.

---

## Not to generate

Screenshots, terminal output, charts, scorecard numbers and the A/B answer text all stay real captures of the running app on the demo workspace. Higgsfield never draws any of them.
