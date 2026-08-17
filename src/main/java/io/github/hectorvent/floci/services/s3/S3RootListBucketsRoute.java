package io.github.hectorvent.floci.services.s3;

import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;

/**
 * Claims "/" for S3 before the console's static {@code index.html}, which Quarkus serves
 * from {@code META-INF/resources} at the same path.
 *
 * <p>Two distinct S3 requests land on "/": a path-style {@code ListBuckets}, and any
 * bucket-level operation in virtual-hosted style, where the bucket lives in the Host
 * header and the path carries only the sub-resource ({@code /?list-type=2} is
 * {@code ListObjectsV2} on that bucket, not a request for the service root). Both are
 * rerouted off "/" so JAX-RS can match them.
 */
@ApplicationScoped
public class S3RootListBucketsRoute {

    private static final int ROUTE_ORDER_BEFORE_DEFAULT = 1000;

    private final S3VirtualHostFilter virtualHostFilter;

    @Inject
    public S3RootListBucketsRoute(S3VirtualHostFilter virtualHostFilter) {
        this.virtualHostFilter = virtualHostFilter;
    }

    void init(@Observes Router router) {
        router.route("/")
                .order(ROUTE_ORDER_BEFORE_DEFAULT)
                .handler(this::rerouteS3RootRequests);
    }

    private void rerouteS3RootRequests(RoutingContext ctx) {
        // Virtual-hosted style is decided by the Host header alone and applies to every
        // method, so it is checked first: for these requests "/" never means the service
        // root. S3VirtualHostFilter cannot do this itself — the static index.html handler
        // answers "/" before any JAX-RS filter runs.
        String bucket = virtualHostFilter.bucketFor(ctx.request().getHeader("Host"));
        if (bucket != null) {
            ctx.reroute(withOriginalQuery(ctx,
                    "/" + S3VirtualHostFilter.INTERNAL_VHOST_SEGMENT + "/" + bucket));
            return;
        }

        String method = ctx.request().method().name();
        boolean listBuckets = S3VirtualHostFilter.isPathStyleListBucketsRequest(
                method,
                ctx.normalizedPath(),
                ctx.request().getHeader("Authorization"))
                // On the S3 service endpoint host "/" is unambiguously the service root,
                // so ListBuckets does not depend on the request being signed. Unsigned
                // callers would otherwise be answered by the static index.html.
                || (isReadMethod(method)
                        && virtualHostFilter.isS3ServiceEndpoint(ctx.request().getHeader("Host")));

        if (listBuckets) {
            ctx.reroute("/" + S3VirtualHostFilter.INTERNAL_LIST_BUCKETS_SEGMENT);
            return;
        }
        ctx.next();
    }

    private static boolean isReadMethod(String method) {
        return "GET".equals(method) || "HEAD".equals(method);
    }

    /**
     * Vert.x rebuilds the query string from the reroute target and discards the original,
     * so it has to be carried across explicitly — {@code ?list-type=2} is what separates
     * {@code ListObjectsV2} from a plain bucket GET.
     */
    private static String withOriginalQuery(RoutingContext ctx, String path) {
        String query = ctx.request().query();
        return (query == null || query.isEmpty()) ? path : path + "?" + query;
    }
}
