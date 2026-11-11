# Changelog

## 2.0.0

Evalbench now answers one question: which model should do this job? It names the cheapest model that is good enough, and shows the proof.

- The home page is the verdict. It opens on one sentence, such as "Use Orion Mini.", with the reasons under it: every model as a dot on accuracy against cost, the bar as a line you can drag, who clears it and who falls short, what to know before you ship, the misses example by example, what the blind judges say, and whether the answer held on earlier runs. When nothing clears the bar it says "No model is good enough yet." and names the closest one. The overview and the scoreboard are gone; old scoreboard links land on the matching verdict.
- A suite sets its bar, the share of examples a model must get right (`bar: 0.9` by default), and a model can carry a price in dollars per million tokens in and out. The pick is the cheapest model that clears the bar, or the fastest if you ask. A model with no price is never called the cheapest.
- Every pick comes with its caveats: how many examples it has to spare, the range its true pass rate could lie in on a sample this size, and what a million answers would cost next to the most accurate model.
- `evalbench run` prints the same verdict in the terminal and takes `--price`, `--bar` and `--fastest`. `--require-pick` exits non-zero when no model clears the bar, so a build can fail on it. `/api/verdict/{suite}` serves it as JSON.
- Text checks can grade one field of a JSON answer: `exact`, `contains`, `not_contains`, `regex` and `length` take a `field` (a dotted path such as `customer.name`), so a job that returns a category, an urgency and a reply is graded label by label. An answer that is one flat JSON object is shown as its fields on the task page and while judging.
- The demo holds two jobs with different answers at the same bar: support ticket triage for an invented invoicing tool, five models over three runs, and the core battery. Nine runs, 820 answers and 239 blind ratings in all. The static demo computes the verdict in the browser with a twin of the server's rule, and both are held to the same 33 shared cases.
- Every page follows the home page: runs, a run, two answers side by side, judging, suites, a suite, models, data and settings are ruled sheets with one left edge instead of stacks of cards. The new run dialog offers the job that was run last, the first visit explains the three steps and offers the demo workspace, and failure text and small counts meet AA contrast in both themes.
- Databases from before prices and bars are upgraded in place. Suites written for 1.x run unchanged.
- The README is rewritten around the verdict with a new set of pictures, and the starter suite shows a bar and a field check.
- Only finished work counts. A model is judged on the latest run it finished: a run that was cancelled or is still going does not move the verdict, so three right out of three so far is never mistaken for a result. An archived model leaves the verdict, and its runs stay on the runs page.
- The README counts the tests that run now: 280 in CI (142 Python, 19 end-to-end, 87 web unit and 32 demo smoke).

## 1.3.0

- A live demo at [gallowforge.github.io/evalbench](https://gallowforge.github.io/evalbench/): the web app itself, built as a static site and answering in the browser from the demo workspace's own data. Every screen works. Ratings, model edits and settings are kept for the visit and forgotten on reload.
- Starting a run in the demo replays the recorded answers and check results for the models you pick, cell by cell, so the result matrix fills the way a real run does; stopping, resuming and deleting work too. What needs the server says so in one sentence instead of failing: saving a suite, testing a model's connection, and accounts.
- A quiet line at the foot of every demo page says it is sample data, that nothing is saved, and links to the source.
- `npm --prefix web run build:demo` builds the demo into `web/dist` for the `/evalbench/` path, with a `404.html` copy so deep links and reloads work on GitHub Pages, and `serve:demo` serves it locally the way Pages does. `capture:demo` regenerates the sample data from a running demo server, so it is never edited by hand. A workflow deploys the demo to GitHub Pages on every push to main.
- The server build behaves as before, and it now stops if the demo's adapter or sample data would be bundled into it.
- Tests: the in-browser adapter is held to the numbers the server computed for the same data, and a browser smoke test loads every route of the built demo under `/evalbench/` in dark and light, at 1280 and 390 pixels wide, with reloads on deep links, and fails on any console error, failed request or sideways overflow.
- The picture at the top of the README is now a loop instead of a still. It opens on the overview, the centre window plays a new run of the core battery from queued to done while the four pass rates fill in, and the overview comes back. The frames are captures of the demo replaying that run, and `docs/readme/src/build.sh` photographs the same moments of it on every build. The other README images were captured again from the current app, so the phone ones show the sections row.
- The README counts the tests that run now: 171 in CI (93 Python, 17 end-to-end, 33 web unit and 28 demo smoke).

## 1.2.1

- Phones: the sections get a full-width row of their own under the logo, with the page you are on scrolled into view, instead of one name beside a strip nobody knew scrolled. The scoreboard no longer forces the page wider than the screen, the head-to-head grid fits, a run's verdict grid puts each task's name above its verdicts so all of them show, and the task list keeps the titles readable. The new-run dialog fits the screen with its Start button, the provider choice wraps, and the judging buttons are a little larger under a thumb.
- A run, task or suite that does not exist now says so at once and links back, instead of a bare error or, for a suite, a spinner that never ended. Unknown addresses get the same page.
- Accessibility: the YAML editor, the check and rubric fields, and the tables that scroll sideways all have names or a tab stop. A wrapped line of run details no longer starts with a dot.
- A browser test on a phone-sized screen guards all of this: the sections row with the current page in view, no screen running off the side, the new-run dialog with its Start button, and the pages for things that do not exist.
- The README counts the tests that run now: 116 in CI (93 Python, 17 end-to-end and 6 web unit).

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
