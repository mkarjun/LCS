package io.github.hectorvent.floci.cloudshell;

import io.github.hectorvent.floci.services.iam.IamService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.List;

/**
 * Mints the temporary credentials a CloudShell session's AWS CLI runs under.
 *
 * <p>These are real LCS STS session credentials, minted exactly as {@code GetSessionToken}
 * mints them and registered with {@link IamService} so the existing IAM enforcement filter
 * gates every call the shell makes. A CloudShell session therefore succeeds or is denied
 * per policy, the same as any other caller — it is never elevated, and it never holds a
 * long-lived key.
 */
@ApplicationScoped
public class CloudShellCredentials {

    private static final Logger LOG = Logger.getLogger(CloudShellCredentials.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final String SECRET_ALPHABET =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    private final IamService iamService;

    @Inject
    public CloudShellCredentials(IamService iamService) {
        this.iamService = iamService;
    }

    /**
     * A minted session credential set. {@code expiration} is when the shell's credentials
     * stop working; {@link CloudShellSessionManager} refreshes them before then.
     */
    public record Session(String accessKeyId, String secretAccessKey, String sessionToken,
                          Instant expiration) {

        /** The {@code "KEY=value"} environment entries an AWS SDK or CLI needs to use these. */
        public List<String> asEnv() {
            return List.of(
                    "AWS_ACCESS_KEY_ID=" + accessKeyId,
                    "AWS_SECRET_ACCESS_KEY=" + secretAccessKey,
                    "AWS_SESSION_TOKEN=" + sessionToken);
        }
    }

    /**
     * Mints and registers a session credential set for the given account.
     *
     * @param accountId       the account the shell acts in
     * @param durationSeconds credential lifetime; clamped to at least one minute
     */
    public Session mint(String accountId, long durationSeconds) {
        String accessKeyId = "ASIA" + randomId(16);
        String secretAccessKey = randomSecret(40);
        String sessionToken = randomSecret(200);
        Instant expiration = Instant.now().plusSeconds(Math.max(60, durationSeconds));

        // No role ARN: like GetSessionToken, these credentials carry the caller's own
        // permissions and are routed back to the caller's account by originAccountId.
        iamService.registerSession(accessKeyId, secretAccessKey, null, expiration, null, accountId);
        LOG.debugv("Minted CloudShell session credentials {0} for account {1}, expiring {2}",
                accessKeyId, accountId, expiration);
        return new Session(accessKeyId, secretAccessKey, sessionToken, expiration);
    }

    private static String randomId(int length) {
        return random(ID_ALPHABET, length);
    }

    private static String randomSecret(int length) {
        return random(SECRET_ALPHABET, length);
    }

    private static String random(String alphabet, int length) {
        StringBuilder builder = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            builder.append(alphabet.charAt(RANDOM.nextInt(alphabet.length())));
        }
        return builder.toString();
    }
}
