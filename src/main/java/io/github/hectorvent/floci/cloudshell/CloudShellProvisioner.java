package io.github.hectorvent.floci.cloudshell;

import io.github.hectorvent.floci.config.EmulatorConfig;
import io.github.hectorvent.floci.core.common.docker.ContainerBuilder;
import io.github.hectorvent.floci.core.common.docker.ContainerLifecycleManager;
import io.github.hectorvent.floci.core.common.docker.ContainerSpec;
import io.github.hectorvent.floci.core.common.docker.LaunchedContainerAwsEnv;
import com.github.dockerjava.api.DockerClient;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Creates the container a CloudShell session runs in.
 *
 * <p>LCS has no EC2/EBS fabric to give a session its own instance and volume, so the
 * mapping is: one container per session, one Docker named volume per account+Region
 * mounted at the home directory. Files a user leaves in {@code ~} therefore survive
 * session restarts and LCS restarts, which is the behaviour AWS CloudShell users rely on.
 */
@ApplicationScoped
public class CloudShellProvisioner {

    private static final Logger LOG = Logger.getLogger(CloudShellProvisioner.class);

    /** Container name prefix; also what the reaper matches stale containers on. */
    static final String CONTAINER_PREFIX = "lcs-cloudshell-";

    private final EmulatorConfig config;
    private final ContainerBuilder containerBuilder;
    private final ContainerLifecycleManager lifecycleManager;
    private final LaunchedContainerAwsEnv awsEnv;
    private final DockerClient dockerClient;

    @Inject
    public CloudShellProvisioner(EmulatorConfig config,
                                 ContainerBuilder containerBuilder,
                                 ContainerLifecycleManager lifecycleManager,
                                 LaunchedContainerAwsEnv awsEnv,
                                 DockerClient dockerClient) {
        this.config = config;
        this.containerBuilder = containerBuilder;
        this.lifecycleManager = lifecycleManager;
        this.awsEnv = awsEnv;
        this.dockerClient = dockerClient;
    }

    /** The container that was created, and which image it ended up running. */
    record Provisioned(String containerId, String containerName, String homeVolume,
                       String image, boolean usingFallbackImage) {
    }

    Provisioned provision(String sessionId, String region, String accountId,
                          CloudShellCredentials.Session credentials) {
        EmulatorConfig.CloudShellServiceConfig cloudShell = config.services().cloudshell();
        String home = cloudShell.homeDirectory();
        String volume = homeVolumeName(cloudShell.homeVolumePrefix(), accountId, region);
        lifecycleManager.ensureVolume(volume);

        ResolvedImage image = resolveImage(cloudShell);
        String containerName = CONTAINER_PREFIX + sessionId;
        // A container left behind by a crashed LCS would block the name.
        lifecycleManager.removeIfExists(containerName);

        ContainerBuilder.Builder builder = containerBuilder.newContainer(image.name())
                .withName(containerName)
                .withEnv(sessionEnv(region, home, credentials))
                .withNamedVolume(volume, home)
                .withWorkingDir(home)
                .withDockerNetwork(cloudShell.dockerNetwork())
                // Required, not optional: the endpoint handed to the shell is LCS's
                // embedded-DNS hostname (localhost.floci.io) whenever that server is
                // running. Without the resolver wired in, every AWS CLI call in the shell
                // fails with "Could not connect to the endpoint URL". Every other
                // container-launching service here does the same.
                .withEmbeddedDns()
                .withLogRotation()
                // The image's own ENTRYPOINT is irrelevant and often wrong for a shell host —
                // amazon/aws-cli, for one, has ENTRYPOINT ["aws"], which would exit instantly.
                // The container exists only to be exec'd into, so it just idles.
                .withEntrypoint(List.of("/bin/sh", "-c"))
                .withCmd(List.of(idleCommand(home)));
        if (cloudShell.memoryMb() > 0) {
            builder.withMemoryMb(cloudShell.memoryMb());
        }

        ContainerSpec spec = builder.build();
        ContainerLifecycleManager.ContainerInfo info = lifecycleManager.createAndStart(spec);
        LOG.infov("CloudShell session {0} started in container {1} from image {2}",
                sessionId, containerName, image.name());
        return new Provisioned(info.containerId(), containerName, volume,
                image.name(), image.fallback());
    }

    /**
     * Keeps the container alive with a shell that exists in every image we support.
     * {@code sleep infinity} is not portable (BusyBox needs a numeric argument), so this
     * loops instead.
     */
    static String idleCommand(String home) {
        return "mkdir -p '" + home + "' && cd '" + home + "' && while true; do sleep 3600; done";
    }

    /**
     * Environment for the session container: the AWS SDK baseline (endpoint, Region) with
     * the placeholder credentials replaced by the session's own temporary ones.
     */
    private List<String> sessionEnv(String region, String home, CloudShellCredentials.Session credentials) {
        List<String> env = new ArrayList<>();
        for (String entry : awsEnv.sdkBaselineEnv(region, Optional.empty())) {
            // Drop the baseline placeholder credentials — the session's STS credentials win,
            // so the shell is subject to IAM enforcement rather than running as "test"/"test".
            if (entry.startsWith("AWS_ACCESS_KEY_ID=")
                    || entry.startsWith("AWS_SECRET_ACCESS_KEY=")
                    || entry.startsWith("AWS_SESSION_TOKEN=")) {
                continue;
            }
            env.add(entry);
        }
        env.addAll(credentials.asEnv());
        env.add("HOME=" + home);
        env.add("TERM=xterm-256color");
        env.add("LANG=C.UTF-8");
        env.add("AWS_PAGER=");
        env.add("LCS_CLOUDSHELL=true");
        return env;
    }

    /** The image actually used for a session, and whether it is the configured fallback. */
    record ResolvedImage(String name, boolean fallback) {
    }

    /**
     * Picks the tools image. The configured image is preferred; if it is neither present
     * locally nor pullable, the fallback is used so CloudShell still works on a machine
     * that has never built the tools image.
     */
    ResolvedImage resolveImage(EmulatorConfig.CloudShellServiceConfig cloudShell) {
        String preferred = cloudShell.image();
        if (isLocallyPresent(preferred)) {
            return new ResolvedImage(preferred, false);
        }
        String fallback = cloudShell.fallbackImage();
        if (preferred.equals(fallback)) {
            return new ResolvedImage(preferred, false);
        }
        LOG.infov("CloudShell tools image {0} is not present locally; falling back to {1}. "
                + "Build the richer image with docker/cloudshell/Dockerfile to get the full "
                + "tool set.", preferred, fallback);
        return new ResolvedImage(fallback, true);
    }

    private boolean isLocallyPresent(String image) {
        try {
            dockerClient.inspectImageCmd(image).exec();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    void destroy(String containerId) {
        lifecycleManager.stopAndRemove(containerId, null);
    }

    /**
     * Home volumes are per account and Region, matching AWS CloudShell's per-Region home
     * directory. The components are lowercased and stripped of anything Docker will not
     * accept in a volume name.
     */
    static String homeVolumeName(String prefix, String accountId, String region) {
        return prefix + "-" + sanitize(accountId) + "-" + sanitize(region);
    }

    private static String sanitize(String value) {
        if (value == null || value.isBlank()) {
            return "default";
        }
        String cleaned = value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9._-]", "-");
        return cleaned.isBlank() ? "default" : cleaned;
    }
}
