import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

const theme = EditorView.theme(
  {
    '&': { backgroundColor: '#0b0e12', color: '#d6deeb', height: '100%' },
    '.cm-scroller': { fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", lineHeight: '1.65' },
    '.cm-content': { padding: '14px 0', caretColor: '#4da3ff' },
    '.cm-gutters': { backgroundColor: '#0b0e12', color: '#4a5260', border: 'none', paddingRight: '6px' },
    '.cm-activeLine': { backgroundColor: '#ffffff06' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8a93a3' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#4da3ff33 !important' },
    '.cm-cursor': { borderLeftColor: '#4da3ff' },
    '.cm-foldGutter span': { color: '#4a5260' },
    '.cm-matchingBracket': { backgroundColor: '#4da3ff26', outline: 'none' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#8cc4ff' },
  { tag: [t.string, t.special(t.string)], color: '#cfd8e6' },
  { tag: [t.number, t.bool, t.null], color: '#f4b66a' },
  { tag: t.comment, color: '#5e6676', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace], color: '#6b7484' },
  { tag: [t.keyword, t.labelName, t.typeName], color: '#c4a7ff' },
  { tag: t.content, color: '#cfd8e6' },
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
