# Evalbench identity

**One idea:** a blind tasting for models. No labels, just judgement.

## The product

- **Look:** an editorial scorecard. Paper and ink, like a printed results sheet: warm paper (`#f3f0e8`), sheets of lighter paper (`#fffdf8`) with hairline rules, ink type (`#17181c`).
- **Colour, 60/30/10:** paper dominant, ink for type, and two accents spent like money: azure (`#2457f0`) only on what can be clicked and on the A side of a pair, scorecard red (`#d23c2a`) only for the judge's marks and for failures. Model colours come from a validated categorical order and are always labelled by name.
- **Type:** Schibsted Grotesk for everything you read, Zilla Slab for scores and the A and B letters, set large. JetBrains Mono only for code.
- **Voice:** fair and sharp. Short sentences, plain verbs: "Judge blind", "Your verdict", "Why?", "The labels, revealed."
- **Signature details:**
  - The overview writes its own headline from the latest run ("Nimbus Pro leads the core battery.").
  - Judging deals two tasting cards with big A and B letters, a paper-form rubric, tick boxes for problems, a seven-stop verdict scale the judge circles in red, and a ruled "Why?" field.
  - When a judge finishes a queue, the cards turn over and reveal who wrote what.
  - The mark: two cards, one face down in azure, one turned up and ticked in red.

## The README images

- **Glass:** the README joins the Glass family of Ali's GitHub profile. The app's real screens float as frosted-glass windows in an ink-black room with a little azure low in the haze (dark), or on warm paper in sunlight (light). Every image ships dark and light, wide and phone, and the dark images show the app in its dark theme, so nothing glares.
- **Staging:** real captures of the running app on the demo workspace. Each feature panel lifts one element out of its screen: the leading row, the Python tests, the verdict scale with the judge's red loop, the top rating with its interval.
- **Motion:** only the hero moves, in a loop at 12 frames a second. It opens on the finished picture, the overview with the leader's row lifted out, and holds it. The row settles back, the centre window turns to a new run of the core battery and plays it until the four pass rates have landed, then it turns back and the row lifts out again. The windows behind drift slowly the whole time; the centre window and the phone hold still, so their text stays sharp. The run is the static demo replaying recorded answers.
- **Copy:** Geist in the images, set flush left beside the glass, with three true numbers under each panel.
- **Source:** `docs/readme/src/build.sh` captures the app (`capture.cjs`) and renders every scene (`render.cjs`, `scene.js`, `layouts.js`); `loop.py` packs the hero's frames into its loop. `social.png` is the earlier plate for the repository's social preview.
