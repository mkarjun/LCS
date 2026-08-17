/**
 * "All services" — the console's service catalog browser.
 *
 * The page is driven entirely by the static catalog (src/services/catalog.ts) and the
 * implemented-service registry, so these specs need no AWS calls at all: the shared
 * fixture's /_lcs/console/summary stub is the only backend involved. Expectations are
 * derived from the catalog source where the value is genuinely data (the counter, the
 * category list) and hardcoded where deriving them from the same module the component
 * uses would make the assertion tautological (which services carry a "Console" badge).
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { CATEGORY_ORDER, SERVICE_CATALOG, servicesByCategory } from "../src/services/catalog";

/**
 * The services listing: the SpaceBetween holding the TextFilter and every category
 * Container.
 *
 * Scoping matters. Cloudscape's AppLayout renders the side navigation *inside* <main>,
 * and that nav carries an <h2> ("Local Cloud Services") plus a link per category and per
 * service — so a page-wide heading or link query silently picks up the rail as well as
 * the page. Anchoring on the filter input walks up to exactly the region the filter
 * controls: input -> input container -> TextFilter root -> SpaceBetween child -> root.
 */
function listing(page: Page): Locator {
  return filterInput(page).locator("xpath=../../../..");
}

function filterInput(page: Page): Locator {
  return page.getByPlaceholder("Find services");
}

/**
 * The filter's result count. TextFilter renders the count twice — once visibly, once in
 * a hidden aria-live region — so match on the id-bearing visible span rather than text,
 * which would hit both and trip strict mode.
 */
function matchCountText(page: Page): Locator {
  return listing(page).locator("[id^='text-filter-search-results']");
}

function categoryHeadings(page: Page): Locator {
  return listing(page).getByRole("heading", { level: 2 });
}

function serviceLinks(page: Page): Locator {
  return listing(page).getByRole("link");
}

/**
 * The row for one service: icon, name link, and (when implemented) the Console badge,
 * all siblings inside a horizontal SpaceBetween. Reached from the link so the assertion
 * cannot drift onto a neighbouring card.
 */
function serviceRow(page: Page, name: string): Locator {
  return page.getByRole("link", { name, exact: true }).locator("xpath=../..");
}

test.beforeEach(async ({ page }) => {
  await page.goto("./services");
  await expect(filterInput(page)).toBeVisible();
});

test("lists the whole catalog under an 'All services' header", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `All services (${SERVICE_CATALOG.length})`,
  );

  // The counter claims the catalog size; check the page actually renders that many.
  await expect(serviceLinks(page)).toHaveCount(SERVICE_CATALOG.length);
});

test("groups services into categories in CATEGORY_ORDER", async ({ page }) => {
  const rendered = await categoryHeadings(page).allTextContents();

  expect(rendered).toEqual(servicesByCategory().map((group) => group.category));

  // Independently of the helper: every heading is a known category, and they appear in
  // ascending CATEGORY_ORDER position.
  // Widened to string[] so an unknown heading yields -1 rather than a type error —
  // the -1 check below is the assertion, so it must stay reachable.
  const positions = rendered.map((text) => (CATEGORY_ORDER as readonly string[]).indexOf(text));
  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
});

test("badges only the services that have a purpose-built console", async ({ page }) => {
  // Hardcoded on purpose: importing the registry would make this pass no matter what the
  // registry said. S3 is implemented, Athena is not.
  const s3 = serviceRow(page, "Amazon S3");
  await expect(s3.locator("[class*='badge-color-green']")).toHaveText("Console");

  const athena = serviceRow(page, "Amazon Athena");
  await expect(athena.getByText("Console", { exact: true })).toHaveCount(0);
  await expect(athena.locator("[class*='badge']")).toHaveCount(0);
});

test("filtering by name narrows the list and reports the match count", async ({ page }) => {
  await filterInput(page).fill("cloudwatch");

  await expect(matchCountText(page)).toHaveText("2 matches");
  await expect(serviceLinks(page)).toHaveText(["Amazon CloudWatch", "Amazon CloudWatch Logs"]);
  await expect(categoryHeadings(page)).toHaveText(["Management & Governance"]);

  // The header counter is the catalog size, not the filtered size.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `All services (${SERVICE_CATALOG.length})`,
  );

  // Clearing restores everything.
  await filterInput(page).fill("");
  await expect(serviceLinks(page)).toHaveCount(SERVICE_CATALOG.length);
});

test("filtering matches description text, not just names", async ({ page }) => {
  const query = "graph";

  // Guard the premise: if a future rename put "graph" in a name, shortName or id, this
  // test would pass without ever exercising the description branch.
  const nonDescriptionMatches = SERVICE_CATALOG.filter(
    (entry) =>
      entry.name.toLowerCase().includes(query) ||
      entry.shortName.toLowerCase().includes(query) ||
      entry.id.toLowerCase().includes(query),
  ).map((entry) => entry.id);
  expect(nonDescriptionMatches, `"${query}" must match descriptions only`).toEqual([]);

  await filterInput(page).fill(query);

  // Amazon Neptune — "Fully managed graph database"; AWS AppSync — "Managed GraphQL APIs".
  await expect(matchCountText(page)).toHaveText("2 matches");
  await expect(serviceLinks(page)).toHaveText(["Amazon Neptune", "AWS AppSync"]);
});

test("shows an empty state when nothing matches", async ({ page }) => {
  await filterInput(page).fill("zzzznotaservice");

  await expect(listing(page).getByText('No services matched "zzzznotaservice".')).toBeVisible();
  await expect(matchCountText(page)).toHaveText("0 matches");
  await expect(serviceLinks(page)).toHaveCount(0);
  await expect(categoryHeadings(page)).toHaveCount(0);
});

test("navigates to a service client-side, without a full page load", async ({ page }) => {
  // Athena has no console surface, so its route renders ServicePlaceholderPage, which
  // makes no AWS calls — the emulator does not need to be running.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__lcsSameDocument = true;
  });

  await page.getByRole("link", { name: "Amazon Athena", exact: true }).click();

  await expect(page).toHaveURL(/\/_lcs\/ui\/athena$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Amazon Athena");
  await expect(page.getByText("Console surface not built yet")).toBeVisible();

  // A full document load would have wiped the sentinel.
  const sameDocument = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__lcsSameDocument === true,
  );
  expect(sameDocument, "clicking a service should not reload the document").toBe(true);
});

test("routes by the catalog path override, not the service id", async ({ page }) => {
  // id "es" -> path "opensearch". The id/path split is easy to break, and the placeholder
  // page reports the id, so both halves of the mapping are checked here.
  await page.getByRole("link", { name: "Amazon OpenSearch Service", exact: true }).click();

  await expect(page).toHaveURL(/\/_lcs\/ui\/opensearch$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Amazon OpenSearch Service");

  const serviceId = page
    .locator("dt")
    .filter({ hasText: "Service id" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(serviceId).toHaveText("es");
});
