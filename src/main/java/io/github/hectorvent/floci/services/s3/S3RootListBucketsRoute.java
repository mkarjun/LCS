package io.github.hectorvent.floci.services.s3;

import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;

@ApplicationScoped
public class S3RootListBucketsRoute {

    private static final int ROUTE_ORDER_BEFORE_DEFAULT = 1000;

    void init(@Observes Router router) {
        router.route("/")
                .order(ROUTE_ORDER_BEFORE_DEFAULT)
                .handler(this::rerouteSignedRootListBuckets);
    }

    private void rerouteSignedRootListBuckets(RoutingContext ctx) {
        if (S3VirtualHostFilter.isPathStyleListBucketsRequest(
                ctx.request().method().name(),
                ctx.normalizedPath(),
                ctx.request().getHeader("Authorization"))) {
            ctx.reroute("/" + S3VirtualHostFilter.INTERNAL_LIST_BUCKETS_SEGMENT);
            return;
        }
        ctx.next();
    }
}