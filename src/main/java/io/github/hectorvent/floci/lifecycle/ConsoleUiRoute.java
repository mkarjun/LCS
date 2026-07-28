package io.github.hectorvent.floci.lifecycle;

import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;

/**
 * Serves the console single-page app for client-side routes.
 *
 * The console ships as static files under {@code META-INF/resources/_lcs/ui}, but its
 * routes ({@code /_lcs/ui/s3}, {@code /_lcs/ui/s3/buckets/name}) have no matching file.
 * Without this fallback they fall through to the S3 catch-all and return NoSuchBucket,
 * which breaks deep links and page refresh.
 *
 * The {@code _lcs} prefix is what keeps this safe: S3 bucket names must start with a
 * lowercase letter or digit, so no bucket can ever be shadowed by this route.
 */
@ApplicationScoped
public class ConsoleUiRoute {

    static final String UI_BASE_PATH = "/_lcs/ui";
    private static final String INDEX_PATH = UI_BASE_PATH + "/index.html";
    private static final int ROUTE_ORDER_BEFORE_DEFAULT = 1000;

    void init(@Observes Router router) {
        router.route(UI_BASE_PATH)
                .order(ROUTE_ORDER_BEFORE_DEFAULT)
                .handler(this::redirectBarePathToTrailingSlash);
        router.route(UI_BASE_PATH + "/*")
                .order(ROUTE_ORDER_BEFORE_DEFAULT)
                .handler(this::serveIndexForClientRoutes);
    }

    /**
     * Vert.x routes are not strict about trailing slashes, so {@code route("/_lcs/ui")}
     * also matches {@code /_lcs/ui/}. Redirecting without this exact-match guard would
     * send {@code /_lcs/ui/} to itself forever.
     */
    private void redirectBarePathToTrailingSlash(RoutingContext ctx) {
        if (needsTrailingSlashRedirect(ctx.normalizedPath())) {
            ctx.redirect(UI_BASE_PATH + "/");
            return;
        }
        ctx.next();
    }

    static boolean needsTrailingSlashRedirect(String normalizedPath) {
        return UI_BASE_PATH.equals(normalizedPath);
    }

    private void serveIndexForClientRoutes(RoutingContext ctx) {
        if (looksLikeStaticAsset(ctx.normalizedPath())) {
            ctx.next();
            return;
        }
        ctx.reroute(INDEX_PATH);
    }

    /**
     * Static assets are matched by known web extensions rather than by "contains a dot".
     *
     * A dot alone is not a safe signal: S3 bucket names may contain dots, so a route
     * like {@code /_lcs/ui/s3/buckets/my.example.com} would be misread as a file and
     * fail to deep-link.
     */
    private static final String[] ASSET_EXTENSIONS = {
            ".js", ".mjs", ".css", ".map", ".html", ".json", ".webmanifest",
            ".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
            ".woff", ".woff2", ".ttf", ".eot", ".txt"
    };

    static boolean looksLikeStaticAsset(String path) {
        if (path == null) {
            return false;
        }
        int lastSlash = path.lastIndexOf('/');
        String lastSegment = lastSlash < 0 ? path : path.substring(lastSlash + 1);
        String lowerSegment = lastSegment.toLowerCase();
        for (String extension : ASSET_EXTENSIONS) {
            if (lowerSegment.endsWith(extension)) {
                return true;
            }
        }
        return false;
    }
}
