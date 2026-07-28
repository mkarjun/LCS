package io.github.hectorvent.floci.lifecycle;

import io.github.hectorvent.floci.config.EmulatorConfig;
import io.github.hectorvent.floci.core.common.ResolvedServiceCatalog;
import io.github.hectorvent.floci.core.common.ServiceDescriptor;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.List;

@Path("{prefix:(_lcs|_floci|_localstack)}/console")
@Produces(MediaType.APPLICATION_JSON)
public class ConsoleController {

    private final ResolvedServiceCatalog catalog;
        private final EmulatorConfig config;
    private final String version;

    @Inject
        public ConsoleController(ResolvedServiceCatalog catalog, EmulatorConfig config) {
        this.catalog = catalog;
                this.config = config;
        this.version = EmulatorInfoController.resolveVersion();
    }

    @GET
    @Path("/summary")
    public Response summary() {
        List<ConsoleService> services = catalog.allStatusDescriptors().stream()
                .map(ConsoleController::toConsoleService)
                .toList();

        int totalCount = services.size();
        int runningCount = (int) services.stream()
                .filter(ConsoleService::enabled)
                .count();

        return Response.ok(new ConsoleSummary(
                version,
                "community",
                "lcs-open-source",
                config.effectiveBaseUrl(),
                config.defaultRegion(),
                config.defaultAccountId(),
                totalCount,
                runningCount,
                totalCount - runningCount,
                services)).build();
    }

    private static ConsoleService toConsoleService(ServiceDescriptor descriptor) {
        return new ConsoleService(
                descriptor.externalKey(),
                descriptor.configKey(),
                descriptor.enabled() ? "running" : "available",
                descriptor.enabled(),
                descriptor.defaultProtocol() == null ? null : descriptor.defaultProtocol().name(),
                descriptor.supportedProtocols().stream()
                        .map(Enum::name)
                        .sorted()
                        .toList(),
                descriptor.supportsStorage(),
                descriptor.storageMode(),
                descriptor.credentialScopes().stream()
                        .sorted()
                        .toList());
    }

    public record ConsoleSummary(
            String version,
            String edition,
            String originalEdition,
            String configuredBaseUrl,
            String defaultRegion,
            String defaultAccountId,
            int totalCount,
            int runningCount,
            int availableCount,
            List<ConsoleService> services
    ) {
    }

    public record ConsoleService(
            String id,
            String configKey,
            String status,
            boolean enabled,
            String defaultProtocol,
            List<String> supportedProtocols,
            boolean supportsStorage,
            String storageMode,
            List<String> credentialScopes
    ) {
    }
}