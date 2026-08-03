package io.github.hectorvent.floci.cloudshell;

import io.github.hectorvent.floci.config.EmulatorConfig;
import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.async.ResultCallback;
import com.github.dockerjava.api.command.ExecCreateCmdResponse;
import com.github.dockerjava.api.model.Frame;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.io.Closeable;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.function.Consumer;

/**
 * Bridges a terminal to a {@code docker exec} PTY inside a session's container.
 *
 * <p>This is the whole of the "terminal gateway" — everything above it (the WebSocket
 * frame protocol) and below it (session and container lifecycle) lives elsewhere, so the
 * transport could be swapped without touching either.
 */
@ApplicationScoped
public class CloudShellTerminalGateway {

    private static final Logger LOG = Logger.getLogger(CloudShellTerminalGateway.class);

    private final EmulatorConfig config;
    private final DockerClient dockerClient;

    @Inject
    public CloudShellTerminalGateway(EmulatorConfig config, DockerClient dockerClient) {
        this.config = config;
        this.dockerClient = dockerClient;
    }

    /**
     * Starts an interactive shell in the session's container.
     *
     * @param session  the session whose container to attach to
     * @param onOutput receives decoded terminal output; called on a Docker transport thread
     * @param onClosed called once when the shell exits or the stream fails
     */
    public Terminal open(CloudShellSession session, Consumer<String> onOutput, Runnable onClosed) {
        EmulatorConfig.CloudShellServiceConfig cloudShell = config.services().cloudshell();
        ExecCreateCmdResponse exec = dockerClient.execCreateCmd(session.containerId())
                .withAttachStdin(true)
                .withAttachStdout(true)
                .withAttachStderr(true)
                .withTty(true)
                .withWorkingDir(cloudShell.homeDirectory())
                .withEnv(List.of(
                        "TERM=xterm-256color",
                        "HOME=" + cloudShell.homeDirectory(),
                        "LANG=C.UTF-8",
                        // The CLI's pager would trap the terminal in `less` with no way out
                        // for a user who does not know to press q.
                        "AWS_PAGER="))
                .withCmd("/bin/sh", "-c", shellSelectionScript(cloudShell.shells()))
                .exec();

        TerminalInputStream stdin = new TerminalInputStream();
        Utf8StreamDecoder decoder = new Utf8StreamDecoder();

        ResultCallback.Adapter<Frame> callback = new ResultCallback.Adapter<>() {
            @Override
            public void onNext(Frame frame) {
                byte[] payload = frame.getPayload();
                if (payload != null && payload.length > 0) {
                    onOutput.accept(decoder.decode(payload));
                }
            }

            @Override
            public void onError(Throwable throwable) {
                LOG.debugv("CloudShell exec stream failed for session {0}: {1}",
                        session.id(), throwable.getMessage());
                onClosed.run();
            }

            @Override
            public void onComplete() {
                onClosed.run();
            }
        };

        dockerClient.execStartCmd(exec.getId())
                .withDetach(false)
                .withTty(true)
                .withStdIn(stdin)
                .exec(callback);

        return new Terminal(exec.getId(), stdin, callback);
    }

    /**
     * A shell selection script rather than a probe: one {@code exec} instead of one per
     * candidate, and it works the same whether or not the image has bash.
     *
     * <p>Shell paths come from configuration and are single-quoted; a path containing a
     * quote is rejected rather than escaped, since no legitimate shell path has one.
     */
    static String shellSelectionScript(List<String> shells) {
        StringBuilder script = new StringBuilder();
        for (String shell : shells) {
            if (shell == null || shell.isBlank() || shell.indexOf('\'') >= 0) {
                continue;
            }
            script.append("[ -x '").append(shell.strip()).append("' ] && exec '")
                    .append(shell.strip()).append("' -l; ");
        }
        // Last resort: /bin/sh exists in every image we can realistically run.
        script.append("exec /bin/sh -l");
        return script.toString();
    }

    /** One live shell: stdin to write to, a size to keep in sync, and a way to end it. */
    public final class Terminal implements Closeable {

        private final String execId;
        private final TerminalInputStream stdin;
        private final Closeable stream;
        private volatile boolean closed;

        private Terminal(String execId, TerminalInputStream stdin, Closeable stream) {
            this.execId = execId;
            this.stdin = stdin;
            this.stream = stream;
        }

        public void write(String data) {
            if (!closed) {
                stdin.write(data.getBytes(StandardCharsets.UTF_8));
            }
        }

        /**
         * Resizes the PTY. Failures are logged and swallowed: a resize races with the shell
         * exiting, and a dead PTY must not turn a benign window resize into an error.
         */
        public void resize(int columns, int rows) {
            if (closed || columns <= 0 || rows <= 0) {
                return;
            }
            try {
                dockerClient.resizeExecCmd(execId).withSize(rows, columns).exec();
            } catch (Exception e) {
                LOG.debugv("CloudShell PTY resize failed for exec {0}: {1}", execId, e.getMessage());
            }
        }

        @Override
        public void close() {
            if (closed) {
                return;
            }
            closed = true;
            stdin.close();
            try {
                stream.close();
            } catch (Exception e) {
                LOG.debugv("Closing CloudShell exec stream {0} failed: {1}", execId, e.getMessage());
            }
        }
    }
}
