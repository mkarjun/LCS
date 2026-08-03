package io.github.hectorvent.floci.cloudshell;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TerminalStreamTest {

    @Test
    void inputStreamDeliversQueuedKeystrokes() {
        TerminalInputStream stream = new TerminalInputStream();
        stream.write("ls\r".getBytes(StandardCharsets.UTF_8));
        byte[] buffer = new byte[16];
        int read = stream.read(buffer, 0, buffer.length);
        assertEquals(3, read);
        assertEquals("ls\r", new String(buffer, 0, read, StandardCharsets.UTF_8));
    }

    @Test
    void inputStreamSpansChunkBoundaries() {
        TerminalInputStream stream = new TerminalInputStream();
        stream.write("ab".getBytes(StandardCharsets.UTF_8));
        stream.write("cd".getBytes(StandardCharsets.UTF_8));
        byte[] buffer = new byte[2];
        assertEquals(2, stream.read(buffer, 0, 2));
        assertEquals("ab", new String(buffer, 0, 2, StandardCharsets.UTF_8));
        assertEquals(2, stream.read(buffer, 0, 2));
        assertEquals("cd", new String(buffer, 0, 2, StandardCharsets.UTF_8));
    }

    @Test
    void closingTheInputStreamEndsTheRead() {
        TerminalInputStream stream = new TerminalInputStream();
        stream.close();
        assertEquals(-1, stream.read(new byte[4], 0, 4));
    }

    @Test
    void closedInputStreamDropsLateWrites() {
        TerminalInputStream stream = new TerminalInputStream();
        stream.close();
        stream.write("ignored".getBytes(StandardCharsets.UTF_8));
        assertEquals(-1, stream.read(new byte[8], 0, 8));
    }

    @Test
    void decoderJoinsMultiByteCharactersSplitAcrossChunks() {
        // A PTY splits at arbitrary byte offsets; decoding each chunk alone would turn the
        // box-drawing characters the AWS CLI's table output uses into replacement chars.
        byte[] bytes = "└─┐".getBytes(StandardCharsets.UTF_8);
        Utf8StreamDecoder decoder = new Utf8StreamDecoder();
        StringBuilder decoded = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            decoded.append(decoder.decode(new byte[]{bytes[i]}));
        }
        assertEquals("└─┐", decoded.toString());
    }

    @Test
    void decoderPassesPlainAsciiThrough() {
        Utf8StreamDecoder decoder = new Utf8StreamDecoder();
        assertEquals("hello", decoder.decode("hello".getBytes(StandardCharsets.UTF_8)));
        assertEquals("", decoder.decode(new byte[0]));
    }

    @Test
    void decoderHandlesSurrogatePairs() {
        byte[] bytes = "🚀".getBytes(StandardCharsets.UTF_8);
        Utf8StreamDecoder decoder = new Utf8StreamDecoder();
        StringBuilder decoded = new StringBuilder();
        decoded.append(decoder.decode(new byte[]{bytes[0], bytes[1]}));
        decoded.append(decoder.decode(new byte[]{bytes[2], bytes[3]}));
        assertEquals("🚀", decoded.toString());
    }

    @Test
    void commandTrackerEmitsOnEnter() {
        CommandLineTracker tracker = new CommandLineTracker();
        assertTrue(tracker.accept("aws s3 ls").isEmpty());
        assertEquals(Optional.of("aws s3 ls"), tracker.accept("\r"));
    }

    @Test
    void commandTrackerAppliesBackspace() {
        CommandLineTracker tracker = new CommandLineTracker();
        tracker.accept("lss");
        tracker.accept("\u007f");
        assertEquals(Optional.of("ls"), tracker.accept("\r"));
    }

    @Test
    void commandTrackerDropsEscapeSequences() {
        CommandLineTracker tracker = new CommandLineTracker();
        tracker.accept("ls");
        // Up arrow: must not land in the recorded line as literal "[A".
        tracker.accept("\u001b[A");
        assertEquals(Optional.of("ls"), tracker.accept("\r"));
    }

    @Test
    void commandTrackerDropsMultiParameterSequences() {
        CommandLineTracker tracker = new CommandLineTracker();
        tracker.accept("ls");
        // Home key on some terminals: parameter bytes before the final byte.
        tracker.accept("\u001b[1;5H");
        assertEquals(Optional.of("ls"), tracker.accept("\r"));
    }

    @Test
    void commandTrackerDropsTwoByteEscapes() {
        CommandLineTracker tracker = new CommandLineTracker();
        tracker.accept("ls");
        // Alt-b: ESC plus one byte, with no CSI introducer to close.
        tracker.accept("\u001bb");
        assertEquals(Optional.of("ls"), tracker.accept("\r"));
    }

    @Test
    void commandTrackerForgetsAbandonedLines() {
        CommandLineTracker tracker = new CommandLineTracker();
        tracker.accept("rm -rf /");
        tracker.accept("\u0003");
        assertTrue(tracker.accept("\r").isEmpty());
    }

    @Test
    void commandTrackerIgnoresBlankLines() {
        CommandLineTracker tracker = new CommandLineTracker();
        assertTrue(tracker.accept("\r").isEmpty());
        assertTrue(tracker.accept("   \r").isEmpty());
    }
}
