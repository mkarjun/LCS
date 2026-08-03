package io.github.hectorvent.floci.cloudshell;

import io.github.hectorvent.floci.config.EmulatorConfig;
import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Owns the lifecycle of CloudShell sessions: creates them on first attach, tracks activity,
 * and reaps them on idle or lifetime timeout.
 *
 * <p>Reaping matters more here than for most container services: a session is created by
 * opening a browser tab, so an abandoned tab would otherwise leave a container running
 * forever.
 */
@ApplicationScoped
public class CloudShellSessionManager {

    private static final Logger LOG = Logger.getLogger(CloudShellSessionManager.class);

    /**
     * Session ids come from the browser, and become a Docker container name. Restricting
     * them keeps a crafted id from injecting anything into a container name or a log
     * stream name.
     */
    private static final Pattern VALID_SESSION_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private static final long REAPER_INTERVAL_SECONDS = 30;

    private final EmulatorConfig config;
    private final CloudShellProvisioner provisioner;
    private final CloudShellCredentials credentials;
    private final CloudShellAudit audit;

    private final Map<String, CloudShellSession> sessions = new ConcurrentHashMap<>();
    private ScheduledExecutorService reaper;

    @Inject
    public CloudShellSessionManager(EmulatorConfig config,
                                    CloudShellProvisioner provisioner,
                                    CloudShellCredentials credentials,
                                    CloudShellAudit audit) {
        this.config = config;
        this.provisioner = provisioner;
        this.credentials = credentials;
        this.audit = audit;
    }

    void onStart(@Observes StartupEvent event) {
        if (!enabled()) {
            return;
        }
        reaper = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "cloudshell-reaper");
            thread.setDaemon(true);
            return thread;
        });
        reaper.scheduleWithFixedDelay(this::reapExpired, REAPER_INTERVAL_SECONDS,
                REAPER_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    void onStop(@Observes ShutdownEvent event) {
        if (reaper != null) {
            reaper.shutdownNow();
        }
        // Sessions are containers LCS created; leaving them behind on shutdown would strand
        // them, since nothing else knows they exist.
        for (CloudShellSession session : List.copyOf(sessions.values())) {
            terminate(session.id(), "lcs shutdown");
        }
    }

    public boolean enabled() {
        return config.services().cloudshell().enabled();
    }

    public Collection<CloudShellSession> sessions() {
        return List.copyOf(sessions.values());
    }

    public Optional<CloudShellSession> find(String sessionId) {
        return Optional.ofNullable(sessions.get(sessionId));
    }

    static boolean isValidSessionId(String sessionId) {
        return sessionId != null && VALID_SESSION_ID.matcher(sessionId).matches();
    }

    /**
     * Returns the session for {@code sessionId}, creating and starting its container on
     * first use.
     *
     * @throws CloudShellException when the id is malformed, the session cap is reached, or
     *                             the container could not be started
     */
    public CloudShellSession openOrCreate(String sessionId, String region, String accountId) {
        if (!enabled()) {
            throw new CloudShellException("CloudShell is disabled (floci.services.cloudshell.enabled=false).");
        }
        if (!isValidSessionId(sessionId)) {
            throw new CloudShellException("Invalid session id. Expected 1-64 characters of [A-Za-z0-9_-].");
        }
        CloudShellSession existing = sessions.get(sessionId);
        if (existing != null) {
            return existing;
        }
        EmulatorConfig.CloudShellServiceConfig cloudShell = config.services().cloudshell();
        // computeIfAbsent would hold the map's bin lock across a container start, so the cap
        // is checked first and creation is serialised on the manager instead.
        synchronized (this) {
            CloudShellSession raced = sessions.get(sessionId);
            if (raced != null) {
                return raced;
            }
            if (sessions.size() >= cloudShell.maxSessions()) {
                throw new CloudShellException("CloudShell session limit reached ("
                        + cloudShell.maxSessions() + "). Close a session and try again.");
            }
            String effectiveRegion = orDefault(region, config.defaultRegion());
            String effectiveAccount = orDefault(accountId, config.defaultAccountId());
            CloudShellCredentials.Session sessionCredentials =
                    credentials.mint(effectiveAccount, cloudShell.sessionTimeoutSeconds());

            CloudShellProvisioner.Provisioned provisioned;
            try {
                provisioned = provisioner.provision(sessionId, effectiveRegion, effectiveAccount,
                        sessionCredentials);
            } catch (RuntimeException e) {
                throw new CloudShellException(
                        "Could not start a CloudShell container. LCS needs the Docker socket "
                                + "mounted (-v /var/run/docker.sock:/var/run/docker.sock). "
                                + rootMessage(e), e);
            }

            CloudShellSession session = new CloudShellSession(sessionId, effectiveRegion,
                    effectiveAccount, provisioned.containerId(), provisioned.containerName(),
                    provisioned.homeVolume(), provisioned.image(), provisioned.usingFallbackImage(),
                    sessionCredentials, Instant.now());
            sessions.put(sessionId, session);
            audit.sessionStarted(session);
            return session;
        }
    }

    /** Records terminal activity so the idle reaper leaves an in-use session alone. */
    public void touch(CloudShellSession session) {
        session.touch(Instant.now());
    }

    void attach(CloudShellSession session) {
        session.attach();
        session.touch(Instant.now());
    }

    void detach(CloudShellSession session) {
        session.detach();
        session.touch(Instant.now());
    }

    /**
     * Tears the session's container down and forgets it. The home volume is deliberately
     * kept — it is the user's files, and AWS keeps them across sessions too.
     */
    public void terminate(String sessionId, String reason) {
        CloudShellSession session = sessions.remove(sessionId);
        if (session == null) {
            return;
        }
        LOG.infov("Terminating CloudShell session {0} ({1})", sessionId, reason);
        audit.sessionEnded(session, reason);
        try {
            provisioner.destroy(session.containerId());
        } catch (RuntimeException e) {
            LOG.warnv("Failed to remove CloudShell container for session {0}: {1}",
                    sessionId, e.getMessage());
        }
    }

    /** Terminates and immediately recreates a session, as AWS's "Restart" action does. */
    public CloudShellSession restart(String sessionId, String region, String accountId) {
        terminate(sessionId, "restart");
        return openOrCreate(sessionId, region, accountId);
    }

    void reapExpired() {
        try {
            EmulatorConfig.CloudShellServiceConfig cloudShell = config.services().cloudshell();
            Instant now = Instant.now();
            List<String> expired = new ArrayList<>();
            for (CloudShellSession session : sessions.values()) {
                if (session.hasExceededLifetime(now, cloudShell.sessionTimeoutSeconds())) {
                    expired.add(session.id());
                } else if (session.isIdleSince(now, cloudShell.idleTimeoutSeconds())) {
                    expired.add(session.id());
                }
            }
            for (String sessionId : expired) {
                terminate(sessionId, "timeout");
            }
        } catch (RuntimeException e) {
            // The reaper is scheduled with a fixed delay; an escaping exception would cancel
            // it permanently and silently stop reaping for the rest of the process's life.
            LOG.warnv("CloudShell reaper pass failed: {0}", e.getMessage());
        }
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private static String rootMessage(Throwable e) {
        Throwable cause = e;
        while (cause.getCause() != null) {
            cause = cause.getCause();
        }
        return cause.getMessage() == null ? "" : cause.getMessage();
    }

    /** Signals a CloudShell request that cannot be served, with a message meant for the user. */
    public static class CloudShellException extends RuntimeException {
        public CloudShellException(String message) {
            super(message);
        }

        public CloudShellException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
