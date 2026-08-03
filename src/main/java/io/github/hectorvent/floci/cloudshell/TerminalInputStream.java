package io.github.hectorvent.floci.cloudshell;

import java.io.InputStream;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * The stdin side of a terminal: keystrokes arrive from the WebSocket and are read by
 * docker-java's exec transport on a different thread.
 *
 * <p>Deliberately not {@link java.io.PipedInputStream}: a piped stream remembers the thread
 * that last wrote to it and starts throwing {@code "Write end dead"} once that thread exits.
 * WebSocket frames are delivered on whichever Vert.x event-loop thread is current, so the
 * writing thread identity is not stable and a piped stream would fail unpredictably.
 */
final class TerminalInputStream extends InputStream {

    /** Zero-length marker queued by {@link #close()} to wake a blocked reader. */
    private static final byte[] POISON = new byte[0];
    private static final long POLL_MILLIS = 250;

    private final BlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
    private volatile boolean closed;
    private byte[] current;
    private int position;

    /** Queues bytes for the reader. Ignored once closed. */
    void write(byte[] data) {
        if (!closed && data != null && data.length > 0) {
            queue.offer(data);
        }
    }

    @Override
    public int read() {
        byte[] single = new byte[1];
        int read = read(single, 0, 1);
        return read == -1 ? -1 : single[0] & 0xff;
    }

    @Override
    public int read(byte[] buffer, int offset, int length) {
        if (length == 0) {
            return 0;
        }
        while (current == null || position >= current.length) {
            if (closed && queue.isEmpty()) {
                return -1;
            }
            byte[] next;
            try {
                next = queue.poll(POLL_MILLIS, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return -1;
            }
            if (next == null) {
                continue;
            }
            if (next.length == 0) {
                return -1;
            }
            current = next;
            position = 0;
        }
        int count = Math.min(length, current.length - position);
        System.arraycopy(current, position, buffer, offset, count);
        position += count;
        return count;
    }

    @Override
    public int available() {
        return current == null ? 0 : Math.max(0, current.length - position);
    }

    @Override
    public void close() {
        closed = true;
        queue.offer(POISON);
    }
}
