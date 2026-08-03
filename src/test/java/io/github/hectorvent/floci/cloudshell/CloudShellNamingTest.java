package io.github.hectorvent.floci.cloudshell;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The names and scripts derived from browser-supplied input. Every one of these values
 * ends up in a Docker container name, a volume name, a log stream name, or a shell
 * command, so their sanitisation is worth pinning down.
 */
class CloudShellNamingTest {

    @Test
    void acceptsTheSessionIdsTheConsoleGenerates() {
        assertTrue(CloudShellSessionManager.isValidSessionId("cs-1767225600000-1"));
        assertTrue(CloudShellSessionManager.isValidSessionId("A_b-9"));
    }

    @Test
    void rejectsSessionIdsThatCouldEscapeAContainerName() {
        assertFalse(CloudShellSessionManager.isValidSessionId(null));
        assertFalse(CloudShellSessionManager.isValidSessionId(""));
        assertFalse(CloudShellSessionManager.isValidSessionId("../etc"));
        assertFalse(CloudShellSessionManager.isValidSessionId("cs 1"));
        assertFalse(CloudShellSessionManager.isValidSessionId("cs/1"));
        assertFalse(CloudShellSessionManager.isValidSessionId("cs;rm -rf /"));
        assertFalse(CloudShellSessionManager.isValidSessionId("x".repeat(65)));
    }

    @Test
    void homeVolumesAreScopedToAccountAndRegion() {
        assertEquals("lcs-cloudshell-home-000000000000-us-east-1",
                CloudShellProvisioner.homeVolumeName("lcs-cloudshell-home", "000000000000", "us-east-1"));
    }

    @Test
    void homeVolumeNamesAreDockerSafe() {
        assertEquals("home-acct-1-eu-west-1",
                CloudShellProvisioner.homeVolumeName("home", "ACCT 1", "eu-west-1"));
        assertEquals("home-default-default",
                CloudShellProvisioner.homeVolumeName("home", null, "  "));
    }

    @Test
    void idleCommandUsesOnlyPortableShellBuiltins() {
        // BusyBox `sleep infinity` is not portable, and neither is bash-only syntax: the
        // fallback image is Amazon Linux, the tools image is too, but a user-configured
        // image could be Alpine.
        String command = CloudShellProvisioner.idleCommand("/home/cloudshell-user");
        assertTrue(command.contains("while true; do sleep 3600; done"));
        assertFalse(command.contains("sleep infinity"));
        assertTrue(command.contains("mkdir -p '/home/cloudshell-user'"));
    }

    @Test
    void shellSelectionPrefersTheFirstAvailableShell() {
        String script = CloudShellTerminalGateway.shellSelectionScript(List.of("/bin/bash", "/bin/sh"));
        assertTrue(script.indexOf("/bin/bash") < script.indexOf("[ -x '/bin/sh' ]"));
        assertTrue(script.endsWith("exec /bin/sh -l"));
    }

    @Test
    void shellSelectionDropsEntriesThatCouldBreakOutOfTheQuoting() {
        String script = CloudShellTerminalGateway.shellSelectionScript(
                List.of("/bin/sh'; rm -rf /; '", "/bin/bash"));
        assertFalse(script.contains("rm -rf"));
        assertTrue(script.contains("/bin/bash"));
    }

    @Test
    void shellSelectionAlwaysHasALastResort() {
        assertEquals("exec /bin/sh -l", CloudShellTerminalGateway.shellSelectionScript(List.of()));
    }

    @Test
    void uploadsAreConfinedToTheHomeDirectory() {
        assertEquals("report.txt", CloudShellFiles.requirePlainFileName(" report.txt "));
        assertThrows(CloudShellSessionManager.CloudShellException.class,
                () -> CloudShellFiles.requirePlainFileName("../../usr/local/bin/aws"));
        assertThrows(CloudShellSessionManager.CloudShellException.class,
                () -> CloudShellFiles.requirePlainFileName("sub/dir.txt"));
        assertThrows(CloudShellSessionManager.CloudShellException.class,
                () -> CloudShellFiles.requirePlainFileName("..\\windows"));
        assertThrows(CloudShellSessionManager.CloudShellException.class,
                () -> CloudShellFiles.requirePlainFileName("  "));
    }
}
