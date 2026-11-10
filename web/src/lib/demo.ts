/**
 * The static demo (`npm run build:demo`): the same pages, answering from sample data in the
 * browser instead of from a server. The flag is fixed at build time, so the server build drops
 * every demo branch and never loads src/demo.
 */
export const DEMO = import.meta.env.VITE_DEMO === '1';

export const REPO_URL = 'https://github.com/gallowforge/evalbench';

/** Checking a suite and grading against it happen on the server, so the demo shows suites without saving them. */
export const SUITES_READ_ONLY = 'Suites are read-only in this demo: checking and grading one needs the server.';
