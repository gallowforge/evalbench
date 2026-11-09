# Changelog

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
