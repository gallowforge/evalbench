# Evalbench identity

**One idea:** the cheapest model that clears your bar, with the proof.

## The product

- **Look:** an editorial scorecard. Paper and ink, like a printed results sheet: warm paper (`#f3f0e8`), sheets ruled with hairlines and one heavy ink rule at the top, ink type (`#17181c`).
- **Colour, 60/30/10:** paper dominant, ink for type, and two accents spent like money: azure (`#2457f0`) only on what can be clicked and on the A side of a pair, scorecard red (`#d23c2a`) only for the judge's marks, the bar's failures and misses. Model colours come from a validated categorical order and are always labelled by name.
- **Type:** Schibsted Grotesk for everything you read, Zilla Slab for the verdict, the scores and the A and B letters, set large. JetBrains Mono only for code.
- **Voice:** fair and sharp. Short sentences, plain verbs, and an answer before the evidence: "Use Orion Mini.", "No model is good enough yet.", "Before you ship it", "Would the answer hold?"
- **Signature details:**
  - The home page is a sentence. It names the model to use, what it costs, and what the most accurate one would cost instead.
  - The bar is a line you drag across the chart, and the sentence follows it.
  - Every model gets one line on the sheet, with the bar ruled between the ones that clear it and the ones that do not, and the plain reason each lost.
  - Judging deals two tasting cards with big A and B letters, a paper-form rubric, tick boxes for problems, a seven-stop verdict scale the judge circles in red, and a ruled "Why?" field.
  - When a judge finishes a queue, the cards turn over and reveal who wrote what.
  - The mark: two cards, one face down in azure, one turned up and ticked in red.

## The README images

- **Glass:** the README joins the Glass family of the author's other repositories. The app's real screens float as frosted-glass windows in an ink-black room with a little azure low in the haze (dark), or on warm paper in sunlight (light). Every image ships dark and light, wide and phone, and the dark images show the app in its dark theme, so nothing glares.
- **Staging:** real captures of the running app on the demo workspace. Each feature panel lifts one element out of its screen: the chart with the bar across it, the models above the bar, one rule of the triage job, the verdict scale with the judge's red loop, the list of what changed since the run before.
- **Motion:** only the hero moves, in a loop at 12 frames a second. It opens on the finished picture, the verdict with its headline lifted out, and holds it. The headline settles back, the centre window turns to a new run of the support triage job and plays it until the five pass rates have landed, then it turns back and the headline lifts out again. The windows behind drift slowly the whole time; the centre window and the phone hold still, so their text stays sharp. The run is the static demo replaying recorded answers.
- **Copy:** Geist in the images, set flush left beside the glass, with three true numbers under each panel.
- **Source:** `docs/readme/src/build.sh` captures the app (`capture.cjs`) and renders every scene (`render.cjs`, `scene.js`, `layouts.js`); `loop.py` packs the hero's frames into its loop. `social.png` is the plate for the repository's social preview.
