/**
 * Identity / account flow.
 *
 * LCS has no login: there is no auth, no session, and credentials are deliberately
 * non-secret (see src/platform/endpoint.ts). The product's actual identity surface is
 * the region and account switcher in the top nav, where the *access key id doubles as
 * the account selector* — an exactly-12-digit key selects that AWS account and isolates
 * its resources, and anything else falls back to the emulator's default account
 * (src/platform/EmulatorContext.tsx, `effectiveAccountId`). These specs cover that.
 *
 * Only the access key is persisted (localStorage `lcs-console-access-key`). The region
 * lives in React state alone, so it resets on reload — asserted below as the behaviour
 * the code actually has, not the behaviour one might expect.
 */
import { test, expect, stubConsoleSummary } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

const ACCESS_KEY_STORAGE_KEY = "lcs-console-access-key";
const DEFAULT_REGION = "us-east-1";
/** The stub's defaultAccountId — what a non-12-digit key resolves to. */
const DEFAULT_ACCOUNT_ID = "000000000000";
const TWELVE_DIGIT_ACCOUNT = "123456789012";

/** Top-nav button whose label is the current region. */
function regionButton(page: Page): Locator {
  return page.getByRole("button", { name: "Region and account settings" });
}

/** Top-nav button whose label is `effectiveAccountId`. */
function accountButton(page: Page): Locator {
  return page.getByRole("button", { name: "Account settings", exact: true });
}

function switcher(page: Page): Locator {
  return page.getByRole("dialog");
}

function regionInput(page: Page): Locator {
  return switcher(page).getByLabel("Region", { exact: true });
}

function accessKeyInput(page: Page): Locator {
  return switcher(page).getByLabel("Access key ID", { exact: true });
}

async function openSwitcher(page: Page, from: "region" | "account" = "region"): Promise<Locator> {
  await (from === "region" ? regionButton(page) : accountButton(page)).click();
  const modal = switcher(page);
  await expect(modal).toBeVisible();
  return modal;
}

/** Waits for the shell to have applied the stubbed summary. */
async function gotoShell(page: Page): Promise<void> {
  await page.goto("./");
  await expect(accountButton(page)).toHaveText(DEFAULT_ACCOUNT_ID);
}

function storedAccessKey(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), ACCESS_KEY_STORAGE_KEY);
}

test("top navigation shows the default region and account", async ({ page }) => {
  await page.goto("./");

  await expect(regionButton(page)).toHaveText(DEFAULT_REGION);
  // "test" is the default access key and is not 12 digits, so the account shown is the
  // summary's defaultAccountId rather than the key itself.
  await expect(accountButton(page)).toHaveText(DEFAULT_ACCOUNT_ID);
  await expect(switcher(page)).toBeHidden();
});

test("either top-nav button opens the region and account switcher", async ({ page }) => {
  await gotoShell(page);

  const fromRegion = await openSwitcher(page, "region");
  await expect(fromRegion.getByText("Region and account", { exact: true })).toBeVisible();
  await expect(regionInput(page)).toHaveValue(DEFAULT_REGION);
  // The modal shows the raw access key, not the derived account id.
  await expect(accessKeyInput(page)).toHaveValue("test");
  await fromRegion.getByRole("button", { name: "Cancel" }).click();
  await expect(switcher(page)).toBeHidden();

  const fromAccount = await openSwitcher(page, "account");
  await expect(fromAccount.getByText("Region and account", { exact: true })).toBeVisible();
});

test("applying a new region updates the region shown in the top nav", async ({ page }) => {
  await gotoShell(page);

  const modal = await openSwitcher(page);
  await regionInput(page).fill("eu-west-1");
  await modal.getByRole("button", { name: "Apply" }).click();

  await expect(switcher(page)).toBeHidden();
  await expect(regionButton(page)).toHaveText("eu-west-1");
  // Region and account are independent knobs.
  await expect(accountButton(page)).toHaveText(DEFAULT_ACCOUNT_ID);
});

test("an exactly-12-digit access key becomes the effective account id", async ({ page }) => {
  await gotoShell(page);

  const modal = await openSwitcher(page, "account");
  await accessKeyInput(page).fill(TWELVE_DIGIT_ACCOUNT);
  await modal.getByRole("button", { name: "Apply" }).click();

  // The account-isolation rule: the key IS the account.
  await expect(accountButton(page)).toHaveText(TWELVE_DIGIT_ACCOUNT);
  await expect(accountButton(page)).not.toHaveText(DEFAULT_ACCOUNT_ID);
  expect(await storedAccessKey(page)).toBe(TWELVE_DIGIT_ACCOUNT);
});

test("a non-12-digit access key falls back to the default account", async ({ page }) => {
  await gotoShell(page);

  for (const key of ["test-user", "12345", "1234567890123"]) {
    const modal = await openSwitcher(page, "account");
    await accessKeyInput(page).fill(key);
    await modal.getByRole("button", { name: "Apply" }).click();

    // The key is accepted and kept — it just does not select an account.
    await expect(accountButton(page)).toHaveText(DEFAULT_ACCOUNT_ID);
    await expect(accountButton(page)).not.toHaveText(key);
    expect(await storedAccessKey(page)).toBe(key);

    const reopened = await openSwitcher(page, "account");
    await expect(accessKeyInput(page)).toHaveValue(key);
    await reopened.getByRole("button", { name: "Cancel" }).click();
    await expect(switcher(page)).toBeHidden();
  }
});

test("the fallback account comes from the summary, not a hardcoded default", async ({ page }) => {
  // Last-registered route wins, so this overrides the auto fixture's stub.
  await stubConsoleSummary(page, { defaultAccountId: "111122223333" });
  await page.goto("./");
  await expect(accountButton(page)).toHaveText("111122223333");

  const modal = await openSwitcher(page, "account");
  await accessKeyInput(page).fill("not-an-account");
  await modal.getByRole("button", { name: "Apply" }).click();

  await expect(accountButton(page)).toHaveText("111122223333");
});

test("the chosen access key persists across a reload", async ({ page }) => {
  await gotoShell(page);

  const modal = await openSwitcher(page, "account");
  await accessKeyInput(page).fill(TWELVE_DIGIT_ACCOUNT);
  await modal.getByRole("button", { name: "Apply" }).click();
  await expect(accountButton(page)).toHaveText(TWELVE_DIGIT_ACCOUNT);

  await page.reload();

  await expect(accountButton(page)).toHaveText(TWELVE_DIGIT_ACCOUNT);
  expect(await storedAccessKey(page)).toBe(TWELVE_DIGIT_ACCOUNT);
  await openSwitcher(page, "account");
  await expect(accessKeyInput(page)).toHaveValue(TWELVE_DIGIT_ACCOUNT);
});

test("the region is not persisted across a reload", async ({ page }) => {
  // Region lives in EmulatorProvider state only; nothing writes it to storage. On reload
  // it re-initialises to us-east-1 and then takes the summary's defaultRegion.
  await gotoShell(page);

  const modal = await openSwitcher(page);
  await regionInput(page).fill("ap-south-1");
  await modal.getByRole("button", { name: "Apply" }).click();
  await expect(regionButton(page)).toHaveText("ap-south-1");

  await page.reload();

  await expect(regionButton(page)).toHaveText(DEFAULT_REGION);
});

test("cancel discards edits to both fields", async ({ page }) => {
  await gotoShell(page);

  const modal = await openSwitcher(page);
  await regionInput(page).fill("eu-central-1");
  await accessKeyInput(page).fill(TWELVE_DIGIT_ACCOUNT);
  await modal.getByRole("button", { name: "Cancel" }).click();

  await expect(switcher(page)).toBeHidden();
  await expect(regionButton(page)).toHaveText(DEFAULT_REGION);
  await expect(accountButton(page)).toHaveText(DEFAULT_ACCOUNT_ID);
  expect(await storedAccessKey(page)).toBeNull();

  // Reopening shows the live values, not the discarded drafts.
  await openSwitcher(page);
  await expect(regionInput(page)).toHaveValue(DEFAULT_REGION);
  await expect(accessKeyInput(page)).toHaveValue("test");
});

test("clearing the access key resets to the default account", async ({ page }) => {
  await gotoShell(page);

  const selected = await openSwitcher(page, "account");
  await accessKeyInput(page).fill(TWELVE_DIGIT_ACCOUNT);
  await selected.getByRole("button", { name: "Apply" }).click();
  await expect(accountButton(page)).toHaveText(TWELVE_DIGIT_ACCOUNT);

  const cleared = await openSwitcher(page, "account");
  await accessKeyInput(page).fill("");
  await cleared.getByRole("button", { name: "Apply" }).click();

  await expect(accountButton(page)).toHaveText(DEFAULT_ACCOUNT_ID);
  // Empty clears the override entirely rather than storing "".
  expect(await storedAccessKey(page)).toBeNull();
  await openSwitcher(page, "account");
  await expect(accessKeyInput(page)).toHaveValue("test");
});
