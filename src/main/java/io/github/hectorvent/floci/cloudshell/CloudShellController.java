package io.github.hectorvent.floci.cloudshell;

import io.github.hectorvent.floci.config.EmulatorConfig;
import com.github.dockerjava.api.DockerClient;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.List;

/**
 * LCS-native control plane for CloudShell. Not an AWS API — the console uses it to decide
 * whether a real terminal is available, and to drive the session actions AWS puts in its
 * Actions menu.
 *
 * <p>Served under the {@code _lcs} prefix for the same reason the console is: S3 bucket
 * names cannot start with an underscore, so nothing here can ever shadow a bucket.
 */
@Path("{prefix:(_lcs|_floci|_localstack)}/cloudshell")
@Produces(MediaType.APPLICATION_JSON)
public class CloudShellController {

    /** Upload cap. Generous for the config and script files CloudShell is used for. */
    private static final int MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

    private final EmulatorConfig config;
    private final CloudShellSessionManager sessionManager;
    private final CloudShellFiles files;
    private final DockerClient dockerClient;

    @Inject
    public CloudShellController(EmulatorConfig config,
                                CloudShellSessionManager sessionManager,
                                CloudShellFiles files,
                                DockerClient dockerClient) {
        this.config = config;
        this.sessionManager = sessionManager;
        this.files = files;
        this.dockerClient = dockerClient;
    }

    /**
     * Whether a real terminal can be served right now, and why not when it cannot.
     *
     * <p>The console calls this before opening a socket: {@code available:false} means it
     * shows its preview shell with the reason, instead of retrying a socket that will
     * never work.
     */
    @GET
    @Path("/status")
    public Response status() {
        EmulatorConfig.CloudShellServiceConfig cloudShell = config.services().cloudshell();
        boolean enabled = cloudShell.enabled();
        String reason = null;
        boolean dockerAvailable = false;
        if (!enabled) {
            reason = "CloudShell is disabled (floci.services.cloudshell.enabled=false).";
        } else {
            dockerAvailable = pingDocker();
            if (!dockerAvailable) {
                reason = "LCS cannot reach the Docker daemon. Run LCS with the Docker socket "
                        + "mounted: -v /var/run/docker.sock:/var/run/docker.sock";
            }
        }

        return Response.ok(new Status(
                enabled,
                enabled && dockerAvailable,
                reason,
                cloudShell.image(),
                cloudShell.fallbackImage(),
                cloudShell.homeDirectory(),
                cloudShell.idleTimeoutSeconds(),
                cloudShell.sessionTimeoutSeconds(),
                cloudShell.maxSessions(),
                sessionManager.sessions().stream().map(CloudShellController::toSummary).toList()
        )).build();
    }

    @POST
    @Path("/sessions/{sessionId}/restart")
    public Response restart(@PathParam("sessionId") String sessionId,
                            @QueryParam("region") String region,
                            @QueryParam("account") String accountId) {
        CloudShellSession session = sessionManager.restart(sessionId, region, accountId);
        return Response.ok(toSummary(session)).build();
    }

    @DELETE
    @Path("/sessions/{sessionId}")
    public Response delete(@PathParam("sessionId") String sessionId) {
        sessionManager.terminate(sessionId, "deleted by user");
        return Response.noContent().build();
    }

    @POST
    @Path("/sessions/{sessionId}/files")
    @Consumes(MediaType.APPLICATION_OCTET_STREAM)
    public Response upload(@PathParam("sessionId") String sessionId,
                           @QueryParam("name") String fileName,
                           byte[] content) {
        if (content == null) {
            content = new byte[0];
        }
        if (content.length > MAX_UPLOAD_BYTES) {
            return error(Response.Status.REQUEST_ENTITY_TOO_LARGE,
                    "Uploads are limited to " + (MAX_UPLOAD_BYTES / (1024 * 1024)) + " MB.");
        }
        CloudShellSession session = requireSession(sessionId);
        files.upload(session, config.services().cloudshell().homeDirectory(), fileName, content);
        sessionManager.touch(session);
        return Response.ok(new UploadResult(
                config.services().cloudshell().homeDirectory() + "/"
                        + CloudShellFiles.requirePlainFileName(fileName),
                content.length)).build();
    }

    @GET
    @Path("/sessions/{sessionId}/files")
    @Produces(MediaType.APPLICATION_OCTET_STREAM)
    public Response download(@PathParam("sessionId") String sessionId,
                             @QueryParam("path") String path) {
        CloudShellSession session = requireSession(sessionId);
        byte[] content = files.download(session, path);
        sessionManager.touch(session);
        String name = path.substring(path.lastIndexOf('/') + 1);
        return Response.ok(content)
                .header("Content-Disposition", "attachment; filename=\"" + name + "\"")
                .build();
    }

    private CloudShellSession requireSession(String sessionId) {
        return sessionManager.find(sessionId).orElseThrow(() ->
                new CloudShellSessionManager.CloudShellException(
                        "No open CloudShell session " + sessionId + ". Open the terminal first."));
    }

    private boolean pingDocker() {
        try {
            dockerClient.pingCmd().exec();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static Response error(Response.Status status, String message) {
        return Response.status(status).entity(new ErrorBody(message)).build();
    }

    private static SessionSummary toSummary(CloudShellSession session) {
        return new SessionSummary(
                session.id(),
                session.region(),
                session.accountId(),
                session.containerName(),
                session.image(),
                session.usingFallbackImage(),
                session.homeVolume(),
                session.createdAt().toString(),
                session.lastActivity().toString(),
                session.attachedTerminals());
    }

    public record Status(boolean enabled,
                         boolean available,
                         String reason,
                         String image,
                         String fallbackImage,
                         String homeDirectory,
                         long idleTimeoutSeconds,
                         long sessionTimeoutSeconds,
                         int maxSessions,
                         List<SessionSummary> sessions) {
    }

    public record SessionSummary(String id,
                                 String region,
                                 String accountId,
                                 String containerName,
                                 String image,
                                 boolean usingFallbackImage,
                                 String homeVolume,
                                 String createdAt,
                                 String lastActivity,
                                 int attachedTerminals) {
    }

    public record UploadResult(String path, int bytes) {
    }

    public record ErrorBody(String message) {
    }
}
