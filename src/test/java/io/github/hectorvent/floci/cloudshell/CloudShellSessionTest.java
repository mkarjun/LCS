package io.github.hectorvent.floci.cloudshell;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CloudShellSessionTest {

    private static final Instant CREATED = Instant.parse("2026-01-01T00:00:00Z");

    private static CloudShellSession session() {
        return new CloudShellSession("cs-1", "us-east-1", "000000000000", "container-id",
                "lcs-cloudshell-cs-1", "lcs-cloudshell-home-000000000000-us-east-1",
                "lcs/cloudshell:latest", false,
                new CloudShellCredentials.Session("ASIATEST", "secret", "token", CREATED),
                CREATED);
    }

    @Test
    void goesIdleOnceNothingIsAttached() {
        CloudShellSession session = session();
        assertTrue(session.isIdleSince(CREATED.plusSeconds(1201), 1200));
    }

    @Test
    void anAttachedTerminalKeepsTheSessionAlive() {
        // A user reading a long output types nothing for minutes. The session must survive
        // that; only an abandoned session — no terminal attached at all — is reclaimed.
        CloudShellSession session = session();
        session.attach();
        assertFalse(session.isIdleSince(CREATED.plusSeconds(99_999), 1200));
    }

    @Test
    void detachingRestartsTheIdleClock() {
        CloudShellSession session = session();
        session.attach();
        assertEquals(0, session.detach());
        session.touch(CREATED.plusSeconds(600));
        assertFalse(session.isIdleSince(CREATED.plusSeconds(1700), 1200));
        assertTrue(session.isIdleSince(CREATED.plusSeconds(1801), 1200));
    }

    @Test
    void detachNeverGoesNegative() {
        CloudShellSession session = session();
        assertEquals(0, session.detach());
        assertEquals(0, session.detach());
    }

    @Test
    void lifetimeCapIgnoresActivity() {
        CloudShellSession session = session();
        session.attach();
        session.touch(CREATED.plusSeconds(43_100));
        assertTrue(session.hasExceededLifetime(CREATED.plusSeconds(43_201), 43_200));
    }

    @Test
    void zeroTimeoutsDisableReaping() {
        CloudShellSession session = session();
        assertFalse(session.isIdleSince(CREATED.plusSeconds(999_999), 0));
        assertFalse(session.hasExceededLifetime(CREATED.plusSeconds(999_999), 0));
    }
}
