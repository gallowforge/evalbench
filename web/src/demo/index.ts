/**
 * The static demo's side of `request()` in api.ts. It is loaded only by a demo build
 * (`npm run build:demo`), so the server build carries none of this and none of the sample data.
 */
import { createBackend, type Fixtures } from './backend';
import fixtures from './data/fixtures.json';

const backend = createBackend(fixtures as unknown as Fixtures);

export const demoRequest = backend.request;

/** Hand the visitor a file the server would have sent, built from what the demo holds right now. */
export function demoDownload(path: string): void {
  const { name, type, text } = backend.file(path);
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
