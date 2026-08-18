package io.github.hectorvent.floci.services.floci.ui;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import jakarta.enterprise.context.ApplicationScoped;

/**
 * Loads and caches the "starting the UI" interstitial served to browsers hitting
 * {@code /_floci/ui}. The resource is read from the classpath ({@code ui/*.html})
 * and must be registered in {@code quarkus.native.resources.includes} so it is
 * embedded in the native image.
 *
 * <p>There is no longer a landing page: {@code /} redirects browsers straight to
 * the console at {@code /_lcs/ui/}.
 */
@ApplicationScoped
public class UiPages {

    private static final String STARTING_RESOURCE = "ui/starting.html";

    private volatile String starting;

    public String startingHtml() {
        String result = starting;
        if (result == null) {
            result = readResource(STARTING_RESOURCE);
            starting = result;
        }
        return result;
    }

    private static String readResource(String resourceName) {
        ClassLoader loader = UiPages.class.getClassLoader();
        try (InputStream input = loader.getResourceAsStream(resourceName)) {
            if (input == null) {
                throw new IllegalStateException("Missing UI resource: " + resourceName);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to load UI resource: " + resourceName, e);
        }
    }
}
