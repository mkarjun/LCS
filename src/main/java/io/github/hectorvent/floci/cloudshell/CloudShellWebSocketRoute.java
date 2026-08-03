package io.github.hectorvent.floci.cloudshell;

import io.vertx.core.Context;
import io.vertx.core.Vertx;
import io.vertx.core.http.ServerWebSocket;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The CloudShell terminal gateway's WebSocket endpoint.
 *
 * <p>Wire protocol, matching {@code console/src/services/cloudshell/session.ts}:
 * <pre>
 *   client -&gt; gateway: {"type":"input","data":"..."}
 *                      {"type":"resize","cols":n,"rows":n}
 *   gateway -&gt; client: {"type":"output","data":"..."}
 *                      {"type":"status","state":"connecting|ready|closed",
 *                       "message":"...","fatal":true|false}
 * </pre>
 *
 * <p>{@code fatal} tells the console that reconnecting will not help — CloudShell is
 * disabled, or there is no Docker socket — so it stops retrying and shows the reason
 * instead of silently dropping to its preview shell.
 *
 * <p>The {@code _lcs} path prefix is what keeps this route safe alongside S3: bucket names
 * must begin with a lowercase letter or digit, so no bucket can shadow it.
 */
@ApplicationScoped
public class CloudShellWebSocketRoute {

    private static final Logger LOG = Logger.getLogger(CloudShellWebSocketRoute.class);

    static final String WS_PATH = "/_lcs/cloudshell/ws";
    /** Ahead of the default routes so the S3 catch-all never sees this path. */
    private static final int ROUTE_ORDER_BEFORE_DEFAULT = 1000;

    private final CloudShellSessionManager sessionManager;
    private final CloudShellTerminalGateway gateway;
    private final CloudShellAudit audit;
    private final Vertx vertx;

    @Inject
    public CloudShellWebSocketRoute(CloudShellSessionManager sessionManager,
                                    CloudShellTerminalGateway gateway,
                                    CloudShellAudit audit,
                                    Vertx vertx) {
        this.sessionManager = sessionManager;
        this.gateway = gateway;
        this.audit = audit;
        this.vertx = vertx;
    }

    void init(@Observes Router router) {
        router.route(WS_PATH)
                .order(ROUTE_ORDER_BEFORE_DEFAULT)
                .handler(this::handleUpgrade);
        LOG.debugv("Registered CloudShell terminal gateway on {0}", WS_PATH);
    }

    private void handleUpgrade(RoutingContext ctx) {
        String sessionId = ctx.request().getParam("session");
        String region = ctx.request().getParam("region");
        String accountId = ctx.request().getParam("account");

        ctx.request().toWebSocket()
                .onFailure(e -> LOG.debugv("CloudShell WebSocket upgrade failed: {0}", e.getMessage()))
                .onSuccess(ws -> bind(ws, sessionId, region, accountId));
    }

    /**
     * Wires one WebSocket to one shell.
     *
     * <p>The socket is accepted before the container is started, rather than failing the
     * upgrade, so that a startup failure can be reported to the user as a message in the
     * terminal instead of an opaque connection error.
     */
    private void bind(ServerWebSocket ws, String sessionId, String region, String accountId) {
        Context context = vertx.getOrCreateContext();
        AtomicReference<CloudShellTerminalGateway.Terminal> terminalRef = new AtomicReference<>();
        AtomicReference<CloudShellSession> sessionRef = new AtomicReference<>();
        CommandLineTracker commands = new CommandLineTracker();

        sendStatus(context, ws, "connecting", "Starting your environment…", false);

        // Both halves block on the Docker daemon — starting the container, and creating the
        // exec — so both belong off the event loop. Splitting them so only the first ran
        // here would put a synchronous `execCreateCmd` back on the event loop, since a
        // Vert.x result handler runs on the originating context.
        vertx.executeBlocking(() -> {
            CloudShellSession session = sessionManager.openOrCreate(sessionId, region, accountId);
            CloudShellTerminalGateway.Terminal terminal = gateway.open(session,
                    data -> sendOutput(context, ws, data),
                    () -> {
                        sendStatus(context, ws, "closed", "Shell exited.", false);
                        context.runOnContext(ignored -> ws.close());
                    });
            return new Attachment(session, terminal);
        }, false).onFailure(e -> {
            LOG.warnv("CloudShell session {0} could not start: {1}", sessionId, e.getMessage());
            sendOutput(context, ws, ansiError(e.getMessage()));
            sendStatus(context, ws, "closed", e.getMessage(), true);
            context.runOnContext(ignored -> ws.close());
        }).onSuccess(attachment -> {
            // Starting takes seconds, so the user may already have navigated away. The close
            // handler ran with nothing to clean up, so this has to clean up after itself.
            if (ws.isClosed()) {
                attachment.terminal().close();
                return;
            }
            sessionRef.set(attachment.session());
            terminalRef.set(attachment.terminal());
            sessionManager.attach(attachment.session());
            if (attachment.session().usingFallbackImage()) {
                sendOutput(context, ws, ansiNotice(
                        "Running the fallback image " + attachment.session().image()
                                + ". Build docker/cloudshell/Dockerfile for the full tool set."));
            }
            sendStatus(context, ws, "ready", null, false);
        });

        ws.textMessageHandler(message -> onClientFrame(message, terminalRef, sessionRef, commands));

        ws.closeHandler(ignored -> {
            CloudShellTerminalGateway.Terminal terminal = terminalRef.getAndSet(null);
            if (terminal != null) {
                terminal.close();
            }
            CloudShellSession session = sessionRef.getAndSet(null);
            if (session != null) {
                // Detach only. The session's container outlives the socket so that a page
                // refresh or a dropped connection does not lose the user's shell state;
                // the idle reaper is what eventually reclaims it.
                sessionManager.detach(session);
            }
        });

        ws.exceptionHandler(e -> LOG.debugv("CloudShell socket error for session {0}: {1}",
                sessionId, e.getMessage()));
    }

    /** A started session and the shell attached to it, produced as one blocking step. */
    private record Attachment(CloudShellSession session, CloudShellTerminalGateway.Terminal terminal) {
    }

    private void onClientFrame(String message,
                               AtomicReference<CloudShellTerminalGateway.Terminal> terminalRef,
                               AtomicReference<CloudShellSession> sessionRef,
                               CommandLineTracker commands) {
        CloudShellTerminalGateway.Terminal terminal = terminalRef.get();
        if (terminal == null) {
            return;
        }
        JsonObject frame;
        try {
            frame = new JsonObject(message);
        } catch (RuntimeException e) {
            LOG.debugv("Discarding malformed CloudShell frame: {0}", e.getMessage());
            return;
        }
        String type = frame.getString("type");
        if ("input".equals(type)) {
            String data = frame.getString("data", "");
            terminal.write(data);
            CloudShellSession session = sessionRef.get();
            if (session != null) {
                sessionManager.touch(session);
                commands.accept(data).ifPresent(line -> audit.command(session, line));
            }
        } else if ("resize".equals(type)) {
            terminal.resize(frame.getInteger("cols", 0), frame.getInteger("rows", 0));
        }
    }

    private void sendOutput(Context context, ServerWebSocket ws, String data) {
        if (data == null || data.isEmpty()) {
            return;
        }
        send(context, ws, new JsonObject().put("type", "output").put("data", data));
    }

    private void sendStatus(Context context, ServerWebSocket ws, String state, String message, boolean fatal) {
        JsonObject frame = new JsonObject().put("type", "status").put("state", state).put("fatal", fatal);
        Optional.ofNullable(message).ifPresent(value -> frame.put("message", value));
        send(context, ws, frame);
    }

    /**
     * All writes are marshalled onto the socket's Vert.x context. Terminal output arrives on
     * a Docker transport thread, and writing to a {@link ServerWebSocket} from an arbitrary
     * thread is not safe.
     */
    private void send(Context context, ServerWebSocket ws, JsonObject frame) {
        context.runOnContext(ignored -> {
            if (!ws.isClosed()) {
                ws.writeTextMessage(frame.encode());
            }
        });
    }

    private static String ansiError(String message) {
        return "\u001b[31m" + safe(message) + "\u001b[0m\r\n";
    }

    private static String ansiNotice(String message) {
        return "\u001b[33m" + safe(message) + "\u001b[0m\r\n";
    }

    private static String safe(String message) {
        return message == null ? "Unknown error." : message.replace("\n", "\r\n");
    }
}
