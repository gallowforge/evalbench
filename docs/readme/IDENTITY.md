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

## The README plates

- **Field:** solid azure, the colour of a face-down card. Turn one over and you see the app, printed on paper. No gradients, glows, grids or pills.
- **Staging:** real captures of the running app on the demo workspace, placed like objects in a product photo with a deep, soft shadow. The hero tilts its screen; feature plates keep it straight and large for legibility.
- **One note per plate:** written in Zilla Slab in paper white, with one pen stroke that stops at the screen's edge. The judge's red loop or underline marks the one thing that matters inside the screen.
- **Surprises:** the scorecard slip in the hero carries the real results; the history plate catches the re-quantised model dropping at run 6; the rate plate's red loop is the app's own.
- **Source:** `web/scripts/readme-visuals.mjs` captures and composes everything; the HTML of each plate is in `docs/readme/src/`.
