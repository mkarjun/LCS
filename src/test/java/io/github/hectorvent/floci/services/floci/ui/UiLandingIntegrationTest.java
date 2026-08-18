package io.github.hectorvent.floci.services.floci.ui;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;

/**
 * Verifies the browser/SDK content-negotiation on {@code /} and the
 * {@code /_floci/ui/status} contract. A browser is redirected to the console;
 * an SDK or CLI caller still gets ListBuckets XML from the same path. These do
 * not spawn the sidecar (only {@code GET /_floci/ui} does), so they need no Docker.
 */
@QuarkusTest
class UiLandingIntegrationTest {

    @Test
    void browserAcceptHtmlIsRedirectedToTheConsole() {
        given()
            .accept("text/html")
            .redirects().follow(false)
        .when()
            .get("/")
        .then()
            // 302 and not 301: "/" is also the S3 service endpoint, so a browser must
            // never cache this as a permanent move.
            .statusCode(302)
            .header("Location", containsString("/_lcs/ui/"));
    }

    @Test
    void consoleIsServedAtTheRedirectTarget() {
        // Guards the redirect against pointing at a path nothing serves.
        given()
            .accept("text/html")
        .when()
            .get("/_lcs/ui/")
        .then()
            .statusCode(200)
            .body(containsString("<div id=\"root\">"));
    }

    @Test
    void sdkClientStillGetsListBucketsXml() {
        // No Accept: text/html — must fall through to S3 ListBuckets, unchanged.
        given()
            .accept("application/xml")
        .when()
            .get("/")
        .then()
            .statusCode(200)
            .body(containsString("ListAllMyBucketsResult"));
    }

    @Test
    void wildcardAcceptIsTreatedAsSdkNotBrowser() {
        // RestAssured default Accept is */* — the strict text/html check must not match.
        given()
        .when()
            .get("/")
        .then()
            .statusCode(200)
            .body(containsString("ListAllMyBucketsResult"));
    }

    @Test
    void statusEndpointReportsNotReadyBeforeStart() {
        given()
            .accept("application/json")
        .when()
            .get("/_floci/ui/status")
        .then()
            .statusCode(200)
            .body("ready", is(false));
    }
}
