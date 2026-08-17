/**
 * CloudShell terminal flow.
 *
 * CloudShell is the one console surface that talks to LCS itself rather than to an AWS
 * API: `/_lcs/cloudshell/status` decides whether a real terminal is on offer, and when it
 * is, the terminal runs over a WebSocket at `/_lcs/cloudshell/ws` speaking the JSON frame
 * protocol in src/services/cloudshell/session.ts. Both are stubbed here — the status route
 * with page.route(), the socket with page.routeWebSocket() — so the whole flow, including
 * the real transport, is exercised with no emulator and no Docker.
 *
 * The framing had only ever been checked by a scripted client, never from a browser. The
 * "renders frames" test below is the browser-side guard: it pushes a real `output` frame
 * across a real WebSocket into a real xterm.js and asserts the text lands in the DOM.
 */
import { test, expect, stubConsoleSummary } from "./fixtures";
import type { Page } from "@playwright/test";

const STATUS_ROUTE = "**/_lcs/cloudshell/status";
const WS_ROUTE = "**/_lcs/cloudshell/ws**";
const SESSION_KEY = "lcs.cloudshell.sessionId";
const WELCOME_KEY = "lcs.cloudshell.welcomeDismissed";

interface StatusBody {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  image: string;
  fallbackImage: string;
  homeDirectory: string;
  idleTimeoutSeconds: number;
  sessionTimeoutSeconds: number;
  maxSessions: number;
  sessions: unknown[];
}

function statusBody(overrides: Partial<StatusBody> = {}): StatusBody {
  return {
    enabled: true,
    available: true,
    reason: null,
    image: "lcs/cloudshell:latest",
    fallbackImage: "alpine:3.20",
    homeDirectory: "/home/cloudshell-user",
    idleTimeoutSeconds: 1200,
    sessionTimeoutSeconds: 43200,
    maxSessions: 2,
    sessions: [],
    ...overrides,
  };
}

/** Stubs the LCS-native status probe the page makes on mount. */
async function stubStatus(page: Page, body: StatusBody): Promise<void> {
  await page.route(STATUS_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

/**
 * Suppresses the first-visit welcome dialog. It is modal, so every test that is not about
 * the dialog itself would otherwise be clicking through it.
 */
async function skipWelcome(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    try {
      window.localStorage.setItem(key, "true");
    } catch {
      // Storage is unavailable on about:blank; the real navigation sets it.
    }
  }, WELCOME_KEY);
}

/** The xterm.js row container — where the terminal's rendered text actually lives. */
function terminal(page: Page) {
  return page.locator(".xterm-rows").first();
}

/** The tab strip is the element holding the "New tab" button; tabs are named by Region. */
function tabStrip(page: Page) {
  return page.getByRole("button", { name: "New tab" }).locator("xpath=..");
}

/** Cloudscape renders an Alert as a role="group" wrapper around header + message. */
function previewAlert(page: Page) {
  return page.getByRole("group").filter({ hasText: "Running the preview shell" });
}

async function openActions(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Actions" }).click();
  await expect(page.getByRole("menuitem", { name: "New tab", exact: true })).toBeVisible();
}

test("the top-nav CloudShell button opens the terminal page", async ({ page }) => {
  await skipWelcome(page);
  await stubStatus(page, statusBody({ enabled: false, available: false, reason: "CloudShell is disabled." }));

  await page.goto("./");
  await page.getByRole("button", { name: "CloudShell", exact: true }).click();

  await expect(page).toHaveURL(/\/_lcs\/ui\/cloudshell$/);
  await expect(page.getByRole("heading", { name: "CloudShell", level: 1 })).toBeVisible();
  await expect(terminal(page)).toBeVisible();
});

test("surfaces the backend's own reason and disables container actions when unavailable", async ({
  page,
}) => {
  // Verbatim from LCS when it runs without a Docker socket — the point of the contract is
  // that the console repeats the backend's words rather than inventing its own.
  const reason = "CloudShell needs the Docker socket, which this LCS process cannot see.";
  await skipWelcome(page);
  await stubStatus(page, statusBody({ available: false, reason }));

  await page.goto("./cloudshell");

  // The reason reaches the user twice: in the page banner, and in the preview shell's own
  // boot banner, so it is visible whichever one they are looking at.
  await expect(previewAlert(page)).toContainText(reason);
  await expect(terminal(page)).toContainText("preview shell");
  await expect(terminal(page)).toContainText(reason);

  // Actions that need a real container must be offered as disabled, not silently inert.
  await openActions(page);
  for (const name of ["Download file", "Upload file", "Restart", "Delete"]) {
    await expect(
      page.getByRole("menuitem", { name, exact: true }),
      `"${name}" must be disabled without a container`,
    ).toHaveAttribute("aria-disabled", "true");
  }
  // Tab management is pure UI and stays usable.
  await expect(page.getByRole("menuitem", { name: "New tab", exact: true })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("reports a legacy LCS build that answers the status path with index.html", async ({ page }) => {
  await skipWelcome(page);
  // An LCS image predating the terminal gateway has no /_lcs/cloudshell/status and serves
  // the console's own SPA shell for it: HTTP 200, text/html. Parsing that as JSON is the
  // crash this branch exists to prevent.
  await page.route(STATUS_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><head><title>LCS</title></head><body><div id=\"root\"></div></body></html>",
    }),
  );

  await page.goto("./cloudshell");

  await expect(previewAlert(page)).toContainText("This LCS build does not serve the CloudShell backend.");
  // Degraded, not broken: the page still renders and still gives you a shell to type in.
  await expect(page.getByRole("heading", { name: "CloudShell", level: 1 })).toBeVisible();
  await expect(terminal(page)).toContainText("preview shell");
});

test("reports LCS as unreachable when the status request cannot complete", async ({ page }) => {
  await skipWelcome(page);
  await page.route(STATUS_ROUTE, (route) => route.abort("failed"));

  await page.goto("./cloudshell");

  await expect(previewAlert(page)).toContainText(
    "Could not reach LCS to check whether CloudShell is available.",
  );
  await expect(terminal(page)).toContainText("preview shell");
});

test("opens the gateway WebSocket and renders the frames it sends", async ({ page }) => {
  await skipWelcome(page);
  await stubStatus(page, statusBody());

  const socketUrls: string[] = [];
  const fromClient: string[] = [];
  await page.routeWebSocket(WS_ROUTE, (ws) => {
    socketUrls.push(ws.url());
    ws.onMessage((message) => fromClient.push(String(message)));
    // Exactly the gateway → client frames documented in session.ts.
    ws.send(JSON.stringify({ type: "status", state: "ready" }));
    ws.send(JSON.stringify({ type: "output", data: "gateway-frame-ok\r\n" }));
  });

  await page.goto("./cloudshell");

  // The payload of an `output` frame has to come out the other end as rendered terminal
  // text. This is the assertion the scripted-client checks never made.
  await expect(terminal(page)).toContainText("gateway-frame-ok");
  // The real transport was taken, not the preview shell standing in for it.
  await expect(previewAlert(page)).toHaveCount(0);
  await expect(terminal(page)).not.toContainText("preview shell");

  // ...and the socket went where session.ts says it goes, carrying the session identity.
  expect(socketUrls.length).toBeGreaterThan(0);
  const storedSessionId = await page.evaluate((key: string) => localStorage.getItem(key), SESSION_KEY);
  const opened = new URL(socketUrls[0]);
  expect(opened.protocol).toBe("ws:");
  expect(opened.pathname).toBe("/_lcs/cloudshell/ws");
  expect(opened.searchParams.get("session")).toBe(storedSessionId);
  expect(opened.searchParams.get("region")).toBe("us-east-1");
  expect(opened.searchParams.get("account")).toBe("000000000000");

  // Client → gateway framing: a keystroke leaves as an `input` frame, not raw bytes.
  await page.locator(".xterm-screen").first().click();
  await page.keyboard.type("z");
  await expect
    .poll(() => fromClient.includes(JSON.stringify({ type: "input", data: "z" })), {
      message: "a keystroke should be sent as an input frame",
    })
    .toBe(true);
});

test("reuses the remembered session id across a reload instead of minting a new one", async ({
  page,
}) => {
  await skipWelcome(page);
  await stubStatus(page, statusBody());

  const sessionsSeen = new Set<string>();
  await page.routeWebSocket(WS_ROUTE, (ws) => {
    const session = new URL(ws.url()).searchParams.get("session");
    if (session !== null) {
      sessionsSeen.add(session);
    }
    ws.onMessage(() => undefined);
    ws.send(JSON.stringify({ type: "status", state: "ready" }));
    ws.send(JSON.stringify({ type: "output", data: "first-visit\r\n" }));
  });

  await page.goto("./cloudshell");
  await expect(terminal(page)).toContainText("first-visit");
  const minted = await page.evaluate((key: string) => localStorage.getItem(key), SESSION_KEY);
  expect(minted).toMatch(/^cs-\d+-primary$/);

  await page.reload();
  await expect(terminal(page)).toContainText("first-visit");
  const afterReload = await page.evaluate((key: string) => localStorage.getItem(key), SESSION_KEY);

  // A fresh id per visit would build a new container each load and burn through the
  // session cap in a handful of reloads.
  expect(afterReload).toBe(minted);
  expect([...sessionsSeen]).toEqual([minted]);
});

test("shows the welcome dialog on a first visit and keeps it dismissed once told to", async ({
  page,
}) => {
  // Deliberately no skipWelcome: this is the first-visit case.
  await stubStatus(page, statusBody({ available: false, reason: "CloudShell is disabled." }));

  await page.goto("./cloudshell");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Welcome to LCS CloudShell");
  expect(await page.evaluate((key: string) => localStorage.getItem(key), WELCOME_KEY)).toBeNull();

  await page.getByRole("checkbox", { name: "Do not show again" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate((key: string) => localStorage.getItem(key), WELCOME_KEY)).toBe("true");

  await page.reload();
  await expect(terminal(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("titles the terminal tab with the current Region", async ({ page }) => {
  // Overrides the auto-fixture stub — the later route wins — so the console's Region is
  // something other than the default, and a tab titled by Region has to follow it.
  await stubConsoleSummary(page, { defaultRegion: "eu-west-1" });
  await skipWelcome(page);
  await stubStatus(page, statusBody({ available: false, reason: "CloudShell is disabled." }));

  // Enter through the shell so the Region is settled before the terminal page mounts.
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Region and account settings" })).toHaveText("eu-west-1");
  await page.getByRole("button", { name: "CloudShell", exact: true }).click();

  await expect(terminal(page)).toBeVisible();
  await expect(tabStrip(page)).toHaveText("eu-west-1");
});
