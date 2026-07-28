package io.github.hectorvent.floci.lifecycle;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConsoleUiRouteTest {

    @Test
    void treatsHashedBundlesAsStaticAssets() {
        assertTrue(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/assets/index-D0jg2ElZ.js"));
        assertTrue(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/assets/index-B8GNjH0x.css"));
        assertTrue(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/index.html"));
        assertTrue(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/favicon.ico"));
    }

    @Test
    void treatsConsoleRoutesAsClientRoutes() {
        assertFalse(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/"));
        assertFalse(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/s3"));
        assertFalse(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/s3/buckets/my-bucket"));
    }

    @Test
    void keepsDottedBucketNamesDeepLinkable() {
        // Bucket names may contain dots, so "contains a dot" cannot be the asset signal.
        assertFalse(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/s3/buckets/my.bucket"));
        assertFalse(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/s3/buckets/my.example.com"));
        assertFalse(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/s3/buckets/logs.2026.01"));
    }

    @Test
    void redirectsOnlyTheBarePathToTrailingSlash() {
        assertTrue(ConsoleUiRoute.needsTrailingSlashRedirect("/_lcs/ui"));
        // Vert.x routes are not strict about trailing slashes, so the bare-path route
        // also matches "/_lcs/ui/". Redirecting that would loop forever.
        assertFalse(ConsoleUiRoute.needsTrailingSlashRedirect("/_lcs/ui/"));
        assertFalse(ConsoleUiRoute.needsTrailingSlashRedirect("/_lcs/ui/s3"));
    }

    @Test
    void handlesNullAndExtensionlessPaths() {
        assertFalse(ConsoleUiRoute.looksLikeStaticAsset(null));
        assertFalse(ConsoleUiRoute.looksLikeStaticAsset("/_lcs/ui/s3/buckets/plain"));
    }
}
