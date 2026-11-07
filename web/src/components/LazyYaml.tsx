import { lazy, Suspense } from 'react';

const Editor = lazy(() => import('./YamlEditor').then((m) => ({ default: m.YamlEditor })));

/** The YAML editor pulls in CodeMirror, so it loads only on pages that show it. */
export function YamlEditor(props: { value: string; onChange: (v: string) => void; minHeight?: number }) {
  return (
    <Suspense fallback={<div className="rounded-[12px] border border-line bg-[#0b0e12]" style={{ height: props.minHeight ?? 420 }} />}>
      <Editor {...props} />
    </Suspense>
  );
}
