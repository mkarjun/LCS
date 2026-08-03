package io.github.hectorvent.floci.cloudshell;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * One CloudShell session: the container it runs in, the home volume behind it, and the
 * temporary credentials the AWS CLI inside it uses.
 *
 * <p>A session outlives any single terminal. The console may attach two terminals to the
 * same session (AWS's split view), detach on navigation, and reattach on return; the
 * container survives all of that and is reaped only by
 * {@link CloudShellSessionManager}'s idle or duration timeout.
 */
public final class CloudShellSession {

    private final String id;
    private final String region;
    private final String accountId;
    private final String containerId;
    private final String containerName;
    private final String homeVolume;
    private final String image;
    private final boolean usingFallbackImage;
    private final CloudShellCredentials.Session credentials;
    private final Instant createdAt;

    private final AtomicReference<Instant> lastActivity = new AtomicReference<>();
    private final AtomicInteger attachedTerminals = new AtomicInteger();

    CloudShellSession(String id, String region, String accountId, String containerId,
                      String containerName, String homeVolume, String image,
                      boolean usingFallbackImage, CloudShellCredentials.Session credentials,
                      Instant createdAt) {
        this.id = id;
        this.region = region;
        this.accountId = accountId;
        this.containerId = containerId;
        this.containerName = containerName;
        this.homeVolume = homeVolume;
        this.image = image;
        this.usingFallbackImage = usingFallbackImage;
        this.credentials = credentials;
        this.createdAt = createdAt;
        this.lastActivity.set(createdAt);
    }

    public String id() {
        return id;
    }

    public String region() {
        return region;
    }

    public String accountId() {
        return accountId;
    }

    public String containerId() {
        return containerId;
    }

    public String containerName() {
        return containerName;
    }

    public String homeVolume() {
        return homeVolume;
    }

    public String image() {
        return image;
    }

    /** True when the configured tools image was unavailable and the fallback image is in use. */
    public boolean usingFallbackImage() {
        return usingFallbackImage;
    }

    public CloudShellCredentials.Session credentials() {
        return credentials;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public Instant lastActivity() {
        return lastActivity.get();
    }

    void touch(Instant now) {
        lastActivity.set(now);
    }

    int attach() {
        return attachedTerminals.incrementAndGet();
    }

    int detach() {
        return attachedTerminals.updateAndGet(count -> Math.max(0, count - 1));
    }

    public int attachedTerminals() {
        return attachedTerminals.get();
    }

    /**
     * A session is idle only when nothing is attached to it. An open terminal keeps the
     * session alive even while the user is reading rather than typing, which is what a
     * terminal user expects and what AWS does.
     */
    boolean isIdleSince(Instant now, long idleTimeoutSeconds) {
        if (idleTimeoutSeconds <= 0 || attachedTerminals.get() > 0) {
            return false;
        }
        return lastActivity.get().plusSeconds(idleTimeoutSeconds).isBefore(now);
    }

    boolean hasExceededLifetime(Instant now, long sessionTimeoutSeconds) {
        if (sessionTimeoutSeconds <= 0) {
            return false;
        }
        return createdAt.plusSeconds(sessionTimeoutSeconds).isBefore(now);
    }
}
