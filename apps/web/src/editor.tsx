import { useEffect, useRef } from "react";
import { EditorState, StateEffect, Compartment } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  keymap,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { tagsIn, validateBody } from "@peel/core";

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return this.checked === other.checked && this.pos === other.pos;
  }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "task-box";
    input.setAttribute(
      "aria-label",
      this.checked ? "Mark task incomplete" : "Mark task complete",
    );
    input.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.pos + 3,
          to: this.pos + 4,
          insert: input.checked ? "x" : " ",
        },
      });
      input.checked =
        view.state.doc.sliceString(this.pos + 3, this.pos + 4).toLowerCase() ===
        "x";
    });
    return input;
  }
  ignoreEvent() {
    return true;
  }
}
function renderMarkdown(view: EditorView): DecorationSet {
  const ranges = [];
  const active = view.hasFocus
    ? view.state.doc.lineAt(view.state.selection.main.head).number
    : -1;
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const line = view.state.doc.line(i),
      text = line.text;
    if (text.startsWith("# ")) {
      ranges.push(Decoration.line({ class: "md-heading" }).range(line.from));
      if (i !== active)
        ranges.push(Decoration.replace({}).range(line.from, line.from + 2));
    }
    const task = text.match(/^- \[([ xX])\] /);
    if (task && i !== active)
      ranges.push(
        Decoration.replace({
          widget: new TaskWidget(task[1] !== " ", line.from),
        }).range(line.from, line.from + 6),
      );
    if (text.startsWith("- ") && !task)
      ranges.push(Decoration.line({ class: "md-list" }).range(line.from));
    if (/^\d+\. /.test(text))
      ranges.push(Decoration.line({ class: "md-list" }).range(line.from));
    for (const match of text.matchAll(/\*\*(.+?)\*\*/g)) {
      const from = line.from + match.index!;
      ranges.push(
        Decoration.mark({ class: "md-bold" }).range(
          from + 2,
          from + match[0].length - 2,
        ),
      );
      if (i !== active) {
        ranges.push(Decoration.replace({}).range(from, from + 2));
        ranges.push(
          Decoration.replace({}).range(
            from + match[0].length - 2,
            from + match[0].length,
          ),
        );
      }
    }
    for (const tag of tagsIn(text))
      ranges.push(
        Decoration.mark({ class: "md-tag" }).range(
          line.from + tag.from,
          line.from + tag.to,
        ),
      );
  }
  return Decoration.set(ranges, true);
}
const markdown = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = renderMarkdown(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged)
        this.decorations = renderMarkdown(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export function MarkdownEditor({
  value,
  onChange,
  onError,
  source,
  readOnly = false,
  canEdit = () => true,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onError: (error: string) => void;
  source: boolean;
  readOnly?: boolean;
  canEdit?: () => boolean;
  autoFocus?: boolean;
}) {
  const parent = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onError, canEdit });
  callbacks.current = { onChange, onError, canEdit };
  const mode = useRef(new Compartment());
  const editing = useRef(new Compartment());
  useEffect(() => {
    const view = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          EditorView.theme({
            ".cm-scroller": {
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            },
          }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          placeholder("A thought worth keeping…"),
          EditorView.contentAttributes.of({
            "aria-label": "Note text",
            autocapitalize: "sentences",
            spellcheck: "true",
          }),
          EditorState.transactionFilter.of((transaction) => {
            if (!transaction.docChanged) return transaction;
            if (!callbacks.current.canEdit()) return [];
            try {
              validateBody(transaction.newDoc.toString());
              return transaction;
            } catch (error) {
              queueMicrotask(() => callbacks.current.onError(String(error)));
              return [];
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
          }),
          mode.current.of(source ? [] : markdown),
          editing.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
        ],
      }),
    });
    editor.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: mode.current.reconfigure(source ? [] : markdown),
    });
  }, [source]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: editing.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);
  return (
    <div
      ref={parent}
      className={`markdown-editor ${source ? "source-mode" : ""}`}
    />
  );
}
