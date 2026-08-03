package io.github.hectorvent.floci.cloudshell;

import io.github.hectorvent.floci.config.EmulatorConfig;
import io.github.hectorvent.floci.services.cloudwatch.logs.CloudWatchLogsService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Writes the CloudShell audit trail to CloudWatch Logs — one log group for the feature,
 * one stream per session. Session start and stop are recorded, and so is every command
 * line submitted, which is the record an operator needs to answer "what did this shell
 * do to my resources".
 *
 * <p>Auditing must never be able to break a terminal, so every write is best-effort, off
 * the terminal's thread, and failures are logged rather than surfaced.
 */
@ApplicationScoped
public class CloudShellAudit {

    private static final Logger LOG = Logger.getLogger(CloudShellAudit.class);

    private final EmulatorConfig config;
    private final CloudWatchLogsService logsService;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "cloudshell-audit");
        thread.setDaemon(true);
        return thread;
    });

    @Inject
    public CloudShellAudit(EmulatorConfig config, CloudWatchLogsService logsService) {
        this.config = config;
        this.logsService = logsService;
    }

    void sessionStarted(CloudShellSession session) {
        record(session, String.format(
                "session start id=%s container=%s image=%s account=%s accessKeyId=%s",
                session.id(), session.containerName(), session.image(), session.accountId(),
                session.credentials().accessKeyId()));
    }

    void sessionEnded(CloudShellSession session, String reason) {
        record(session, String.format("session end id=%s reason=%s", session.id(), reason));
    }

    void command(CloudShellSession session, String commandLine) {
        String trimmed = commandLine.strip();
        if (trimmed.isEmpty()) {
            return;
        }
        record(session, "command " + trimmed);
    }

    private void record(CloudShellSession session, String message) {
        EmulatorConfig.CloudShellServiceConfig cloudShell = config.services().cloudshell();
        if (!cloudShell.auditEnabled()) {
            return;
        }
        String group = cloudShell.auditLogGroup();
        String stream = session.id();
        String region = session.region();
        long timestamp = System.currentTimeMillis();
        executor.submit(() -> {
            try {
                ensureStream(group, stream, region);
                logsService.putLogEvents(group, stream,
                        List.of(Map.of("timestamp", timestamp, "message", message)), region);
            } catch (Exception e) {
                LOG.debugv("CloudShell audit write failed for session {0}: {1}",
                        session.id(), e.getMessage());
            }
        });
    }

    /**
     * Creates the group and stream if they are missing. Both creates throw
     * {@code ResourceAlreadyExistsException} when they already exist, which is the normal
     * case after the first event and is deliberately swallowed.
     */
    private void ensureStream(String group, String stream, String region) {
        try {
            logsService.createLogGroup(group, null, Map.of(), region);
        } catch (Exception e) {
            // Already exists.
        }
        try {
            logsService.createLogStream(group, stream, region);
        } catch (Exception e) {
            // Already exists.
        }
    }
}
