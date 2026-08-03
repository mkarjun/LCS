package io.github.hectorvent.floci.cloudshell;

import java.util.Optional;

/**
 * Reconstructs command lines from the keystrokes flowing to a PTY, so the audit trail can
 * record what was run.
 *
 * <p>This is an approximation and is documented as one: the gateway sees keystrokes, not
 * the shell's own line editor. Plain typing, backspace, and Enter are tracked exactly.
 * History recall, tab completion, and Ctrl-R searches change the line inside the shell
 * without sending the resulting text back through stdin, so those lines are recorded as
 * whatever was typed rather than what finally ran. Escape sequences are skipped rather
 * than logged as text.
 *
 * <p>An exact record would need shell-side instrumentation (a {@code PROMPT_COMMAND} hook
 * writing history out of band); that is a larger change and is not what the audit
 * requirement asks for.
 */
final class CommandLineTracker {

    private static final int MAX_LINE_LENGTH = 4096;

    private static final char ESCAPE = 0x1b;
    private static final char DELETE = 0x7f;
    private static final char BACKSPACE = 0x08;
    /** Ctrl-C and Ctrl-U both abandon the line being typed. */
    private static final char CTRL_C = 0x03;
    private static final char CTRL_U = 0x15;

    /**
     * Escape-sequence state. A single "are we in an escape" flag is not enough: the byte
     * right after ESC is {@code [} for CSI, which is itself inside the @-to-~ final-byte
     * range, so a flat check ends the sequence one byte early and leaks the rest of it
     * (an up arrow, {@code ESC [ A}, lands in the recorded line as "A").
     */
    private enum EscapeState {
        /** Ordinary text. */
        NONE,
        /** ESC seen; the next byte says whether a longer sequence follows. */
        AFTER_ESCAPE,
        /** Inside a CSI or SS3 sequence, consuming until its final byte. */
        IN_SEQUENCE
    }

    private final StringBuilder line = new StringBuilder();
    private EscapeState escapeState = EscapeState.NONE;

    /**
     * Feeds one chunk of stdin.
     *
     * @return the completed command line when the chunk ended a line, otherwise empty
     */
    Optional<String> accept(String input) {
        String completed = null;
        for (int i = 0; i < input.length(); i++) {
            char ch = input.charAt(i);
            if (escapeState == EscapeState.AFTER_ESCAPE) {
                // CSI ("ESC [") and SS3 ("ESC O") introduce a longer sequence. Anything
                // else — an Alt-key chord, say — is a two-byte sequence already complete.
                escapeState = (ch == '[' || ch == 'O') ? EscapeState.IN_SEQUENCE : EscapeState.NONE;
                continue;
            }
            if (escapeState == EscapeState.IN_SEQUENCE) {
                // Parameter and intermediate bytes run 0x20-0x3F; the final byte is @ to ~.
                if (ch >= '@' && ch <= '~') {
                    escapeState = EscapeState.NONE;
                }
                continue;
            }
            if (ch == ESCAPE) {
                escapeState = EscapeState.AFTER_ESCAPE;
            } else if (ch == '\r' || ch == '\n') {
                completed = line.toString();
                line.setLength(0);
            } else if (ch == DELETE || ch == BACKSPACE) {
                if (line.length() > 0) {
                    line.setLength(line.length() - 1);
                }
            } else if (ch == CTRL_C || ch == CTRL_U) {
                line.setLength(0);
            } else if (ch >= ' ' && line.length() < MAX_LINE_LENGTH) {
                line.append(ch);
            }
        }
        return Optional.ofNullable(completed).filter(value -> !value.isBlank());
    }
}
