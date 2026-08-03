package io.github.hectorvent.floci.cloudshell;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * Decodes a byte stream to UTF-8 text across chunk boundaries.
 *
 * <p>A PTY hands back arbitrary byte chunks, so a multi-byte character can straddle two of
 * them. Decoding each chunk independently would turn every such character into replacement
 * characters — visible as mojibake in box-drawing output, accented text, and emoji. This
 * keeps the trailing partial sequence and prepends it to the next chunk.
 *
 * <p>Not thread-safe: one instance per terminal, used only from that terminal's output
 * callback.
 */
final class Utf8StreamDecoder {

    private final CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE);

    private byte[] carry = new byte[0];

    String decode(byte[] chunk) {
        if (chunk == null || chunk.length == 0) {
            return "";
        }
        ByteBuffer input = ByteBuffer.allocate(carry.length + chunk.length);
        input.put(carry);
        input.put(chunk);
        input.flip();

        CharBuffer output = CharBuffer.allocate(input.remaining() + 1);
        decoder.decode(input, output, false);
        output.flip();

        // Whatever the decoder could not consume is the start of a character whose
        // remaining bytes are in the next chunk.
        carry = new byte[input.remaining()];
        input.get(carry);
        return output.toString();
    }
}
