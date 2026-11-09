import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

// Colours come from the page's tokens, so the editor follows the light and dark themes.
const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--color-panel)', color: 'var(--color-ink)', height: '100%' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", lineHeight: '1.7' },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--color-ink)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-panel-2)',
    color: 'var(--color-faint)',
    border: 'none',
    borderRight: '1px solid var(--color-line)',
    paddingRight: '4px',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-ink) 3%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-ink-2)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)', borderLeftWidth: '2px' },
  '.cm-foldGutter span': { color: 'var(--color-faint)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', outline: 'none' },
  '.cm-tooltip, .cm-panels': { backgroundColor: 'var(--color-panel)', color: 'var(--color-ink)', border: '1px solid var(--color-line-2)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-warn) 25%, transparent)' },
});

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--color-accent)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--color-ink)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--code-keyword)' },
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace], color: 'var(--code-comment)' },
  { tag: [t.keyword, t.labelName, t.typeName], color: 'var(--code-keyword)' },
  { tag: t.content, color: 'var(--color-ink)' },
]);

export function YamlEditor({ value, onChange, minHeight = 420 }: { value: string; onChange: (v: string) => void; minHeight?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          yaml(),
          theme,
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => u.docChanged && changeRef.current(u.state.doc.toString())),
        ],
      }),
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="overflow-hidden rounded-[12px] border border-line" style={{ minHeight, height: minHeight }} />;
}
