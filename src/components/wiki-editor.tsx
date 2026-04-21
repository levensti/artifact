"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

interface WikiEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  focusCoords?: { x: number; y: number } | null;
}

export default function WikiEditor({
  content,
  onChange,
  placeholder = "Start writing...",
  autoFocus = false,
  focusCoords = null,
}: WikiEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: "wiki-code-block" } },
        blockquote: { HTMLAttributes: { class: "wiki-blockquote" } },
        horizontalRule: {},
        bulletList: {},
        orderedList: {},
        listItem: {},
        code: {},
        bold: {},
        italic: {},
        strike: {},
      }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    immediatelyRender: false,
    autofocus: autoFocus && !focusCoords ? "start" : false,
    editorProps: {
      attributes: {
        class: "wiki-tiptap-editor",
      },
    },
    onUpdate: ({ editor: e }) => {
      const md = (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
      onChangeRef.current(md);
    },
  });

  const focusCoordsRef = useRef(focusCoords);
  useEffect(() => {
    focusCoordsRef.current = focusCoords;
  }, [focusCoords]);
  const didFocusCoords = useRef(false);
  useEffect(() => {
    if (!editor || !focusCoordsRef.current || didFocusCoords.current) return;
    didFocusCoords.current = true;
    requestAnimationFrame(() => {
      const coords = focusCoordsRef.current;
      if (!coords) return;
      const pos = editor.view.posAtCoords({ left: coords.x, top: coords.y });
      if (pos) {
        editor.commands.focus();
        editor.commands.setTextSelection(pos.pos);
      } else {
        editor.commands.focus("start");
      }
    });
  }, [editor]);

  // Sync content from outside only when the editor loses focus or on
  // initial mount — avoids cursor jumps during typing.
  const initialContentRef = useRef(content);
  useEffect(() => {
    if (!editor) return;
    if (initialContentRef.current !== content && !editor.isFocused) {
      editor.commands.setContent(content);
      initialContentRef.current = content;
    }
  }, [editor, content]);

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  return <EditorContent editor={editor} />;
}
