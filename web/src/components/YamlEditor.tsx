import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

const theme = EditorView.theme(
  {
    '&': { backgroundColor: '#fffdf8', color: '#17181c', height: '100%' },
    '.cm-scroller': { fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", lineHeight: '1.7' },
    '.cm-content': { padding: '16px 0', caretColor: '#17181c' },
    '.cm-gutters': { backgroundColor: '#f9f6ef', color: '#b3ada2', border: 'none', borderRight: '1px solid #e6e0d3', paddingRight: '4px' },
    '.cm-activeLine': { backgroundColor: '#17181c08' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#6c6b67' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#2457f02e !important' },
    '.cm-cursor': { borderLeftColor: '#17181c', borderLeftWidth: '2px' },
    '.cm-foldGutter span': { color: '#b3ada2' },
    '.cm-matchingBracket': { backgroundColor: '#2457f01f', outline: 'none' },
  },
  { dark: false },
);

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#2457f0', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#17181c' },
  { tag: [t.number, t.bool, t.null], color: '#b4531c' },
  { tag: t.comment, color: '#9c988f', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace], color: '#9c988f' },
  { tag: [t.keyword, t.labelName, t.typeName], color: '#b4531c' },
  { tag: t.content, color: '#17181c' },
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
