# Changelog

## 1.2.0

- A dark theme: the same editorial scorecard printed the other way round, ink-black stock with warm off-white type. Azure still marks only what you can click and red only the judge's marks; both are stepped up so every line of text keeps AA contrast.
- Light, dark or system, from the sun or moon in the top bar, the sign-in page, or Settings. System is the default and follows the device live; a fixed choice is remembered in this browser and applied before the first paint, so pages never flash the wrong theme.
- Charts, the head-to-head ramp, model colours, code, the YAML editor, the judging cards, the reveal and the sign-in card each have their own dark values rather than an inverted copy. Model colours take the categorical palette's validated dark step.
- Accessibility: axe runs on every screen in both themes in the browser tests, including the sign-in steps, a marked-up judging card, the reveal and the theme menu. That run fixed four things that were already there in light: verdict buttons whose spoken name differed from their text, an unlabelled run picker and suite filter, code blocks that could not be scrolled from the keyboard, and a muted grey that fell just short of AA on segmented controls. Chart end labels are now set in ink beside a stroke of the model's colour, and reduced motion lands every animation at once.
- A few light-theme values moved for contrast too: the head-to-head cells from 60% to 80% now use ink on their pale azure, zero regressions on the overview read at 3:1 instead of fading out, and code comments are a shade darker.
- The theme menu also opens from the arrow keys, and on a phone the top bar's sideways-scrolling menu keeps the page you are on in view.

## 1.1.0

- Sign-in is now a username and a password, so password managers save and fill the whole login. The first-visit page creates the owner account; `EVALBENCH_USERNAME` sits beside `EVALBENCH_PASSWORD` to set it from the environment.
- A wrong username gets exactly the answer a wrong password gets: the same message, delay and back-off, with both checked in constant time. Usernames ignore case.
- The sign-in forms read their values when submitted and never wait for typing, so autofill that sets values without key events works. A browser test proves it.
- Installs from 1.0 keep their password: after upgrading, everyone signs in once more, and the owner picks a username.

## 1.0.0

First release.

- Suites of tasks, automatic checks and rubrics, written in YAML or edited in the browser, with field-level validation.
- Seven check types: exact answer, contains, avoids, regular expression, length, JSON and Python tests.
- Models: Anthropic and OpenAI through their official SDKs, and any OpenAI-compatible server such as LM Studio or Ollama. Keys are read from the environment, never stored, and bound to their provider's own API.
- Runs with frozen suite and model settings, per-model parallel limits, live progress, cancel and resume.
- Side-by-side answers with every check's verdict and reason.
- Blind pairwise rating: shuffled anonymous pairs, rubric scores, issue flags, a seven-point preference, justification and confidence, with a balanced queue per rater, and a reveal of who wrote what once a rater's queue is done.
- Scoreboard with pass rates, Bradley-Terry human ratings with bootstrap intervals, win rates, categories, history and regressions between runs.
- Exports: ratings as CSV or JSONL, DPO-ready preference pairs, and run results.
- A sandbox container for model-written code: no route out, read-only, a separate user per execution, refused by the app.
- Sign-in on by default, with first-visit password setup.
- The core battery: 20 tasks across reasoning, constraint following and debugging, and a demo workspace.
- An editorial scorecard design: paper and ink, large type, scores in a slab face, an overview that writes its own headline, judging on tasting cards, AA contrast throughout, and layouts that hold at phone width.
- One Docker image for amd64 and arm64, one compose file, and `evalbench run` for headless CI gates.
