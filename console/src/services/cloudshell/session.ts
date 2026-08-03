/**
 * CloudShell terminal session transport.
 *
 * The console talks to the LCS terminal gateway over a WebSocket using a tiny framed
 * protocol (below). The gateway bridges the socket to a `docker exec` PTY inside the
 * session's container — see `io.github.hectorvent.floci.cloudshell` on the backend.
 *
 * Wire protocol (JSON text frames, both directions):
 *   client → gateway:
 *     { "type": "input",  "data": "<utf8 stdin>" }
 *     { "type": "resize", "cols": <n>, "rows": <n> }
 *   gateway → client:
 *     { "type": "output", "data": "<utf8 stdout/stderr, may contain ANSI>" }
 *     { "type": "status", "state": "connecting"|"ready"|"closed",
 *       "message"?: "", "fatal"?: true }
 *
 * `fatal` means reconnecting cannot help (CloudShell disabled, no Docker socket), so the
 * client stops retrying and leaves the reason on screen.
 *
 * The path is `/_lcs/cloudshell/ws?session=<id>` on the same origin, so no CORS and no
 * separate endpoint configuration.
 *
 * When the backend reports itself unavailable, CloudShellPage runs the in-browser preview
 * shell below instead, with the backend's own reason in its banner. The preview is never a
 * silent substitute for a broken terminal — it appears only when LCS has said there is no
 * terminal to be had.
 */

export type SessionState = "connecting" | "ready" | "closed";

export interface TerminalSession {
  onOutput(cb: (data: string) => void): void;
  onState(cb: (state: SessionState, message?: string) => void): void;
  send(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface SessionOptions {
  /** Run the in-browser preview shell instead of connecting. */
  probeSim?: boolean;
  /** Shown in the preview shell's banner to explain why there is no real terminal. */
  simReason?: string;
  region?: string;
  account?: string;
}

const WS_PATH = "/_lcs/cloudshell/ws";
/** Reconnect attempts before giving up on a gateway that keeps dropping the socket. */
const MAX_RECONNECT_ATTEMPTS = 5;

export function openSession(sessionId: string, opts: SessionOptions = {}): TerminalSession {
  if (opts.probeSim) {
    return simulatedSession(opts.simReason);
  }
  return reconnectingSession(sessionId, opts);
}

function reconnectingSession(sessionId: string, opts: SessionOptions): TerminalSession {
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let attempts = 0;
  // Set once the gateway says the failure is permanent, so we stop reconnecting.
  let fatal = false;
  const outputCbs: ((data: string) => void)[] = [];
  const stateCbs: ((state: SessionState, message?: string) => void)[] = [];

  const emitOutput = (data: string) => outputCbs.forEach((cb) => cb(data));
  const emitState = (state: SessionState, message?: string) =>
    stateCbs.forEach((cb) => cb(state, message));

  const url = () => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const query = new URLSearchParams({ session: sessionId });
    if (opts.region) {
      query.set("region", opts.region);
    }
    if (opts.account) {
      query.set("account", opts.account);
    }
    return `${proto}//${window.location.host}${WS_PATH}?${query}`;
  };

  const connect = () => {
    emitState("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url());
    } catch {
      emitState("closed", "Could not open a connection to the CloudShell gateway.");
      return;
    }
    socket = ws;

    ws.onopen = () => {
      attempts = 0;
    };
    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as {
          type: string;
          data?: string;
          state?: SessionState;
          message?: string;
          fatal?: boolean;
        };
        if (frame.type === "output" && frame.data !== undefined) {
          emitOutput(frame.data);
        } else if (frame.type === "status" && frame.state) {
          if (frame.fatal) {
            fatal = true;
          }
          emitState(frame.state, frame.message);
        }
      } catch {
        // Non-JSON frames are treated as raw output.
        emitOutput(String(event.data));
      }
    };
    ws.onclose = () => {
      socket = null;
      if (closedByUser || fatal) {
        emitState("closed");
        return;
      }
      attempts += 1;
      if (attempts > MAX_RECONNECT_ATTEMPTS) {
        emitOutput("\r\n\x1b[31mLost the connection to the CloudShell gateway.\x1b[0m\r\n");
        emitState("closed", "Disconnected.");
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

  connect();

  return {
    onOutput: (cb) => outputCbs.push(cb),
    onState: (cb) => stateCbs.push(cb),
    send: (data) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    },
    resize: (cols, rows) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    },
    close: () => {
      closedByUser = true;
      socket?.close();
    },
  };
}

/**
 * In-browser preview shell. Not a real terminal — enough of one to keep the CloudShell UI
 * usable (prompt, line editing, history, a handful of commands) on an LCS that cannot
 * serve a real one. Its banner states why, so it is never mistaken for the real thing.
 */
function simulatedSession(reason?: string): TerminalSession {
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
    "LCS CloudShell — preview shell\r\n" +
    "\x1b[0m" +
    (reason ? `\x1b[33m${reason}\x1b[0m\r\n` : "") +
    "This is an in-browser preview. A real terminal runs the AWS CLI in a container,\r\n" +
    "pre-authenticated against LCS with your own IAM session.\r\n" +
    "Try: help, aws --version, whoami, echo, clear.\r\n\r\n";

  const run = (cmd: string) => {
    const [name, ...rest] = cmd.trim().split(/\s+/);
    switch (name) {
      case "":
        return;
      case "help":
        out(
          "Preview commands: help, whoami, pwd, aws, echo <text>, clear, date.\r\n" +
            "With the CloudShell backend available, every command runs in a real container\r\n" +
            "under your IAM session.\r\n",
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
          out("aws-cli/2.x (LCS CloudShell preview — the real CLI runs in the session container)\r\n");
        } else {
          out(
            "\x1b[33mThe AWS CLI runs in the CloudShell session container, not in this preview.\x1b[0m\r\n" +
              "It is pre-authenticated with your LCS IAM session — no configure step.\r\n",
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
