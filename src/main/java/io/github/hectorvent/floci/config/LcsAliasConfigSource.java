package io.github.hectorvent.floci.config;

import org.eclipse.microprofile.config.spi.ConfigSource;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;

/**
 * Exposes {@code LCS_*} environment variables and {@code lcs.*} system properties
 * as aliases for the existing {@code floci.*} configuration model.
 *
 * <p>This keeps the current runtime stable while allowing the public-facing LCS
 * naming transition to start immediately. The alias source intentionally has a
 * higher ordinal than the default environment-variable source so {@code LCS_*}
 * wins when both alias and legacy names are present.
 */
public class LcsAliasConfigSource implements ConfigSource {

    private static final String LEGACY_PREFIX = "floci.";
    private static final String ALIAS_PREFIX = "lcs.";
    private static final String ALIAS_ENV_PREFIX = "LCS_";

    @Override
    public int getOrdinal() {
        return 350;
    }

    @Override
    public Set<String> getPropertyNames() {
        Set<String> names = new LinkedHashSet<>();

        Properties systemProperties = System.getProperties();
        for (String name : systemProperties.stringPropertyNames()) {
            if (name.startsWith(ALIAS_PREFIX)) {
                names.add(LEGACY_PREFIX + name.substring(ALIAS_PREFIX.length()));
            }
        }

        for (String envName : System.getenv().keySet()) {
            if (envName.startsWith(ALIAS_ENV_PREFIX)) {
                names.add(bestEffortPropertyName(envName));
            }
        }

        return names;
    }

    @Override
    public String getValue(String propertyName) {
        if (!propertyName.startsWith(LEGACY_PREFIX)) {
            return null;
        }

        String suffix = propertyName.substring(LEGACY_PREFIX.length());

        String systemAlias = System.getProperty(ALIAS_PREFIX + suffix);
        if (hasText(systemAlias)) {
            return systemAlias;
        }

        String environmentAlias = System.getenv(toAliasEnvName(suffix));
        if (hasText(environmentAlias)) {
            return environmentAlias;
        }

        return null;
    }

    @Override
    public String getName() {
        return "LcsAliasConfigSource";
    }

    private static String toAliasEnvName(String suffix) {
        return ALIAS_ENV_PREFIX + suffix
                .replace('.', '_')
                .replace('-', '_')
                .toUpperCase(Locale.ROOT);
    }

    private static String bestEffortPropertyName(String envName) {
        return LEGACY_PREFIX + envName.substring(ALIAS_ENV_PREFIX.length())
                .toLowerCase(Locale.ROOT)
                .replace('_', '.');
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}