import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { openSession } from "./session";
import type { SessionState, TerminalSession } from "./session";

export interface XtermHandle {
  /** Write text into the terminal (e.g. pasted content). */
  paste(text: string): void;
  /** Copy the current selection to the clipboard; returns false if nothing selected. */
  copySelection(): boolean;
  clear(): void;
  focus(): void;
  fit(): void;
}

/**
 * An xterm.js terminal bound to a {@link TerminalSession}.
 *
 * AWS CloudShell's terminal behaviours are reproduced here: ANSI colour, UTF-8, mouse
 * selection, a fit-to-container addon that drives PTY resize, and Ctrl/Cmd+C copy when
 * there is a selection (falling back to SIGINT when there is none, as a real shell does).
 */
export const XtermView = forwardRef<
  XtermHandle,
  { sessionId: string; useSim: boolean; onState: (state: SessionState, message?: string) => void }
>(function XtermView({ sessionId, useSim, onState }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);

  useImperativeHandle(ref, () => ({
    paste: (text) => sessionRef.current?.send(text),
    copySelection: () => {
      const term = termRef.current;
      if (term && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return true;
      }
      return false;
    },
    clear: () => termRef.current?.clear(),
    focus: () => termRef.current?.focus(),
    fit: () => fitRef.current?.fit(),
  }));

  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      // AWS CloudShell's dark palette.
      theme: {
        background: "#0f1b2d",
        foreground: "#e6edf3",
        cursor: "#e6edf3",
        selectionBackground: "#2a4a6a",
      },
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const session = openSession(sessionId, { probeSim: useSim });
    sessionRef.current = session;
    session.onOutput((data) => term.write(data));
    session.onState((state, message) => onState(state, message));

    // Keystrokes → session. Copy on Ctrl/Cmd+C when text is selected (else pass through
    // as ^C / SIGINT), matching terminal conventions.
    term.attachCustomKeyEventHandler((event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "c" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (mod && event.key.toLowerCase() === "v") {
        void navigator.clipboard.readText().then((text) => session.send(text));
        return false;
      }
      return true;
    });
    term.onData((data) => session.send(data));

    const pushResize = () => {
      fit.fit();
      session.resize(term.cols, term.rows);
    };
    const observer = new ResizeObserver(pushResize);
    observer.observe(containerRef.current);
    window.addEventListener("resize", pushResize);
    term.focus();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", pushResize);
      session.close();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, useSim, onState]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
});
