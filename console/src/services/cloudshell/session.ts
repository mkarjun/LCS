/**
 * CloudShell terminal session transport.
 *
 * The console talks to the terminal gateway over a WebSocket using a tiny framed protocol
 * (below). The gateway is a planned LCS backend service that bridges the socket to a
 * `docker exec` PTY inside a per-session tools container. Until that backend ships, this
 * client falls back to an in-browser simulated shell so the CloudShell UI is fully
 * usable and reviewable — the seam is the WebSocket, so swapping the sim for the real
 * gateway changes nothing above this file.
 *
 * Wire protocol (JSON text frames, both directions):
 *   client → gateway:
 *     { "type": "input",  "data": "<utf8 stdin>" }
 *     { "type": "resize", "cols": <n>, "rows": <n> }
 *   gateway → client:
 *     { "type": "output", "data": "<utf8 stdout/stderr, may contain ANSI>" }
 *     { "type": "status", "state": "connecting"|"ready"|"closed", "message"?: "" }
 *
 * The path is `/_lcs/cloudshell/ws?session=<id>` on the same origin, so no CORS and the
 * browser sends the console's session cookie/creds context.
 */

export type SessionState = "connecting" | "ready" | "closed";

export interface TerminalSession {
  onOutput(cb: (data: string) => void): void;
  onState(cb: (state: SessionState, message?: string) => void): void;
  send(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

const WS_PATH = "/_lcs/cloudshell/ws";

/**
 * Opens a real gateway session, auto-reconnecting with backoff. If the gateway is not
 * reachable (no backend yet), resolves to a simulated session instead so the terminal
 * still works. `probeSim` forces the simulator (used by tests / offline demos).
 */
export function openSession(sessionId: string, opts: { probeSim?: boolean } = {}): TerminalSession {
  if (opts.probeSim) {
    return simulatedSession();
  }
  return reconnectingSession(sessionId);
}

function reconnectingSession(sessionId: string): TerminalSession {
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let attempts = 0;
  let fallback: TerminalSession | null = null;
  const outputCbs: ((data: string) => void)[] = [];
  const stateCbs: ((state: SessionState, message?: string) => void)[] = [];

  const emitOutput = (data: string) => outputCbs.forEach((cb) => cb(data));
  const emitState = (state: SessionState, message?: string) =>
    stateCbs.forEach((cb) => cb(state, message));

  const connect = () => {
    emitState("connecting");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}${WS_PATH}?session=${encodeURIComponent(sessionId)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      startFallback();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      attempts = 0;
      emitState("ready");
    };
    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as {
          type: string;
          data?: string;
          state?: SessionState;
          message?: string;
        };
        if (frame.type === "output" && frame.data !== undefined) {
          emitOutput(frame.data);
        } else if (frame.type === "status" && frame.state) {
          emitState(frame.state, frame.message);
        }
      } catch {
        // Non-JSON frames are treated as raw output.
        emitOutput(String(event.data));
      }
    };
    ws.onclose = () => {
      socket = null;
      if (closedByUser) {
        emitState("closed");
        return;
      }
      attempts += 1;
      // First failure with no server at all → drop to the simulator so the UI works.
      if (attempts >= 2 && fallback === null) {
        startFallback();
        return;
      }
      const delay = Math.min(1000 * 2 ** attempts, 8000);
      emitState("connecting", `Reconnecting in ${Math.round(delay / 1000)}s…`);
      setTimeout(() => {
        if (!closedByUser) {
          connect();
        }
      }, delay);
    };
    ws.onerror = () => ws.close();
  };

  const startFallback = () => {
    fallback = simulatedSession();
    fallback.onOutput(emitOutput);
    fallback.onState(emitState);
  };

  connect();

  return {
    onOutput: (cb) => outputCbs.push(cb),
    onState: (cb) => stateCbs.push(cb),
    send: (data) => {
      if (fallback) {
        fallback.send(data);
      } else if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    },
    resize: (cols, rows) => {
      if (fallback) {
        fallback.resize(cols, rows);
      } else if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    },
    close: () => {
      closedByUser = true;
      fallback?.close();
      socket?.close();
    },
  };
}

/**
 * In-browser simulated shell. Not a real terminal — enough of one to demonstrate the
 * CloudShell UX (prompt, line editing, history, a handful of commands) until the gateway
 * backend lands. Clearly labelled as a preview in its banner so it is never mistaken for
 * the real thing.
 */
function simulatedSession(): TerminalSession {
  const outputCbs: ((data: string) => void)[] = [];
  const stateCbs: ((state: SessionState, message?: string) => void)[] = [];
  // Buffer output and the current state, then replay them to each listener as it
  // registers. This makes the boot banner deterministic regardless of when the terminal
  // attaches its callbacks — including React StrictMode's mount/unmount/mount — instead of
  // racing a setTimeout.
  const outLog: string[] = [];
  let currentState: SessionState = "connecting";
  const out = (s: string) => {
    outLog.push(s);
    outputCbs.forEach((cb) => cb(s));
  };
  const emitState = (state: SessionState, message?: string) => {
    currentState = state;
    stateCbs.forEach((cb) => cb(state, message));
  };
  const PROMPT = "\x1b[32m[cloudshell-user@lcs\x1b[0m ~]$ ";

  let line = "";
  const history: string[] = [];
  let historyIdx = 0;

  const banner =
    "\x1b[36m" +
    "Welcome to LCS CloudShell (preview)\r\n" +
    "\x1b[0m" +
    "This is an in-browser preview shell. The real terminal — a per-session container\r\n" +
    "with the AWS CLI pre-authenticated against LCS — arrives with the gateway backend.\r\n" +
    "Try: help, aws --version, whoami, echo, clear.\r\n\r\n";

  const run = (cmd: string) => {
    const [name, ...rest] = cmd.trim().split(/\s+/);
    switch (name) {
      case "":
        return;
      case "help":
        out(
          "Preview commands: help, whoami, pwd, aws, echo <text>, clear, date.\r\n" +
            "In the full backend every command runs in a real container with your IAM session.\r\n",
        );
        return;
      case "whoami":
        out("cloudshell-user\r\n");
        return;
      case "pwd":
        out("/home/cloudshell-user\r\n");
        return;
      case "date":
        out(`${new Date().toString()}\r\n`);
        return;
      case "echo":
        out(`${rest.join(" ")}\r\n`);
        return;
      case "aws":
        if (rest[0] === "--version") {
          out("aws-cli/2.x (LCS CloudShell preview — real CLI runs in the backend container)\r\n");
        } else {
          out(
            "\x1b[33mThe AWS CLI runs in the CloudShell backend container, not in this preview.\x1b[0m\r\n" +
              "It will be pre-authenticated with your LCS IAM session — no configure step.\r\n",
          );
        }
        return;
      case "clear":
        out("\x1b[2J\x1b[H");
        return;
      default:
        out(`${name}: command not found (preview shell). Try 'help'.\r\n`);
    }
  };

  // Boot synchronously into the buffer; listeners replay it on registration.
  emitState("ready");
  out(banner);
  out(PROMPT);

  return {
    // Replay buffered output/state so a listener attaching after boot still sees it.
    onOutput: (cb) => {
      outputCbs.push(cb);
      outLog.forEach((s) => cb(s));
    },
    onState: (cb) => {
      stateCbs.push(cb);
      cb(currentState);
    },
    send: (data) => {
      // Up/Down arrows recall command history, redrawing the current line.
      if (data === "\x1b[A" || data === "\x1b[B") {
        if (history.length === 0) {
          return;
        }
        historyIdx =
          data === "\x1b[A"
            ? Math.max(0, historyIdx - 1)
            : Math.min(history.length, historyIdx + 1);
        const recalled = historyIdx < history.length ? history[historyIdx] : "";
        // Erase the current line back to the prompt, then write the recalled command.
        out("\r\x1b[K" + PROMPT + recalled);
        line = recalled;
        return;
      }
      for (const ch of data) {
        if (ch === "\r") {
          out("\r\n");
          const cmd = line;
          if (cmd.trim() !== "") {
            history.push(cmd);
          }
          historyIdx = history.length;
          run(cmd);
          line = "";
          out(PROMPT);
        } else if (ch === "\x7f") {
          // Backspace.
          if (line.length > 0) {
            line = line.slice(0, -1);
            out("\b \b");
          }
        } else if (ch === "\x1b") {
          // Swallow the rest of an escape sequence (arrow keys handled by the terminal).
          continue;
        } else if (ch >= " ") {
          line += ch;
          out(ch);
        }
      }
    },
    resize: () => undefined,
    close: () => emitState("closed"),
  };
}
