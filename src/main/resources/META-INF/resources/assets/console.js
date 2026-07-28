const summaryUrl = "/_lcs/console/summary";
const serviceUrlBase = "/_lcs/console/services";
const recentStorageKey = "lcs-console-recent";

const shortcutCandidates = ["lambda", "s3", "ec2", "dynamodb", "sqs", "iam", "cloudformation", "kms"];
const fallbackRecentIds = ["bedrock-runtime", "s3", "ec2", "rds", "lambda", "iam", "cloudformation", "kms", "dynamodb", "sqs"];

const categoryConfig = [
    { id: "compute", label: "Compute", copy: "Functions, containers, clusters, and API front doors.", keys: ["lambda", "ec2", "ecs", "eks", "apigateway", "apigatewayv2", "kafka", "scheduler"] },
    { id: "storage", label: "Storage", copy: "Buckets, tables, streams, caches, and databases.", keys: ["s3", "dynamodb", "elasticache", "rds", "neptune", "kinesis", "firehose", "appconfig", "appconfigdata"] },
    { id: "integration", label: "Integration", copy: "Queues, topics, events, workflow, and transfer services.", keys: ["sqs", "sns", "events", "states", "pipes", "transfer", "email"] },
    { id: "security", label: "Security", copy: "Identity, keys, certificates, and secret stores.", keys: ["iam", "kms", "acm", "secretsmanager", "cognito-idp"] },
    { id: "observability", label: "Observability", copy: "Logs, metrics, tracing-adjacent management, and billing signals.", keys: ["logs", "monitoring", "ce", "cur", "bcm-data-exports"] },
    { id: "platform", label: "Platform", copy: "Infrastructure orchestration, registries, configuration, and edge services.", keys: ["cloudformation", "codebuild", "codedeploy", "tagging", "ecr", "config", "cloudfront", "route53", "athena", "glue", "backup", "pricing", "transcribe", "textract", "bedrock-runtime"] }
];

const commandExamples = {
    s3: "aws --endpoint-url {endpoint} s3 ls",
    dynamodb: "aws --endpoint-url {endpoint} dynamodb list-tables",
    lambda: "aws --endpoint-url {endpoint} lambda list-functions",
    sqs: "aws --endpoint-url {endpoint} sqs list-queues",
    sns: "aws --endpoint-url {endpoint} sns list-topics",
    iam: "aws --endpoint-url {endpoint} iam list-roles",
    kms: "aws --endpoint-url {endpoint} kms list-keys",
    secretsmanager: "aws --endpoint-url {endpoint} secretsmanager list-secrets",
    states: "aws --endpoint-url {endpoint} stepfunctions list-state-machines",
    apigateway: "aws --endpoint-url {endpoint} apigateway get-rest-apis",
    apigatewayv2: "aws --endpoint-url {endpoint} apigatewayv2 get-apis",
    ec2: "aws --endpoint-url {endpoint} ec2 describe-instances",
    ecs: "aws --endpoint-url {endpoint} ecs list-clusters",
    route53: "aws --endpoint-url {endpoint} route53 list-hosted-zones",
    cloudformation: "aws --endpoint-url {endpoint} cloudformation list-stacks",
    cognito: "aws --endpoint-url {endpoint} cognito-idp list-user-pools --max-results 10",
    "cognito-idp": "aws --endpoint-url {endpoint} cognito-idp list-user-pools --max-results 10",
    email: "aws --endpoint-url {endpoint} ses list-identities",
    ses: "aws --endpoint-url {endpoint} ses list-identities",
    bedrock: "aws --endpoint-url {endpoint} bedrock-runtime list-foundation-models",
    "bedrock-runtime": "aws --endpoint-url {endpoint} bedrock-runtime list-foundation-models"
};

const nameOverrides = {
    acm: "ACM",
    apigateway: "API Gateway",
    apigatewayv2: "API Gateway V2",
    appconfig: "AppConfig",
    appconfigdata: "AppConfig Data",
    autoscaling: "Auto Scaling",
    bedrock: "Bedrock",
    "bedrock-runtime": "Bedrock Runtime",
    cloudformation: "CloudFormation",
    cloudwatchlogs: "CloudWatch Logs",
    cloudwatchmetrics: "CloudWatch Metrics",
    codebuild: "CodeBuild",
    codedeploy: "CodeDeploy",
    cognito: "Cognito",
    configservice: "AWS Config",
    dynamodb: "DynamoDB",
    ecr: "ECR",
    ecs: "ECS",
    ec2: "EC2",
    eks: "EKS",
    elbv2: "Elastic Load Balancing",
    eventbridge: "EventBridge",
    firehose: "Kinesis Data Firehose",
    glue: "Glue",
    iam: "IAM",
    kms: "KMS",
    kinesis: "Kinesis",
    lambda: "Lambda",
    msk: "MSK",
    opensearch: "OpenSearch",
    route53: "Route 53",
    s3: "S3",
    scheduler: "Scheduler",
    secretsmanager: "Secrets Manager",
    ses: "SES",
    sns: "SNS",
    sqs: "SQS",
    ssm: "SSM",
    stepfunctions: "Step Functions"
};

const state = {
    summary: null,
    services: [],
    servicePage: null,
    status: "all",
    query: "",
    selectedServiceId: null,
    recentServiceIds: readRecentServiceIds(),
    endpoint: window.location.origin,
    configuredBaseUrl: "",
    version: "--",
    defaultRegion: "--",
    defaultAccountId: "--",
    route: {
        serviceId: null,
        resourceId: null
    },
    navOpen: false
};

document.addEventListener("DOMContentLoaded", () => {
    wireFilters();
    wireActions();
    wireNavigation();
    syncRouteFromLocation();
    window.addEventListener("popstate", handlePopState);
    loadSummary();
});

function wireFilters() {
    const globalSearch = document.getElementById("global-search");
    const localSearch = document.getElementById("service-search");
    const filterButtons = document.querySelectorAll("#status-filter .toggle-button");

    [globalSearch, localSearch].forEach((input) => {
        input.addEventListener("input", (event) => {
            syncSearch(event.target.value);
        });
    });

    globalSearch?.addEventListener("focus", () => {
        renderGlobalSearchResults();
    });

    globalSearch?.addEventListener("keydown", handleGlobalSearchKeydown);

    filterButtons.forEach((button) => {
        button.addEventListener("click", () => {
            state.status = button.dataset.status;
            filterButtons.forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
            renderCollections();
        });
    });
}

function wireActions() {
    const viewAllTargets = [document.getElementById("view-all-button"), document.getElementById("view-all-link")];

    viewAllTargets.forEach((button) => {
        button.addEventListener("click", () => {
            clearServiceRoute();
            document.getElementById("services-panel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
}

function wireNavigation() {
    const brandHomeButton = document.getElementById("brand-home-button");
    const menuTrigger = document.getElementById("menu-trigger");
    const navDrawerClose = document.getElementById("nav-drawer-close");
    const homeButton = document.querySelector('.nav-icon[aria-label="Console home"]');
    const servicesButton = document.querySelector('.nav-icon[aria-label="Services"]');
    const cliButton = document.querySelector('.nav-icon[aria-label="CLI"]');
    const settingsButton = document.querySelector('.nav-icon[aria-label="Settings"]');

    brandHomeButton?.addEventListener("click", () => {
        openHomeAnchor("home-overview");
    });

    menuTrigger?.addEventListener("click", (event) => {
        event.stopPropagation();
        setDrawerOpen(!state.navOpen);
    });

    navDrawerClose?.addEventListener("click", () => {
        setDrawerOpen(false);
    });

    homeButton?.addEventListener("click", () => {
        openHomeAnchor("home-overview");
    });

    servicesButton?.addEventListener("click", () => {
        openHomeAnchor("services-panel");
    });

    cliButton?.addEventListener("click", () => {
        openHomeAnchor("run-widget");
    });

    settingsButton?.addEventListener("click", () => {
        openHomeAnchor("home-overview");
    });

    document.addEventListener("click", handleChromeDocumentClick);
    document.addEventListener("keydown", handleChromeKeydown);
}

function handleGlobalSearchKeydown(event) {
    if (event.key === "Escape") {
        closeGlobalSearchResults();
        return;
    }

    if (event.key !== "Enter") {
        return;
    }

    const firstMatch = topSearchMatches()[0];
    if (!firstMatch) {
        return;
    }

    event.preventDefault();
    openService(firstMatch.id);
}

function handleChromeDocumentClick(event) {
    const searchShell = document.getElementById("global-search-shell");
    if (searchShell && !searchShell.contains(event.target)) {
        closeGlobalSearchResults();
    }

    if (!state.navOpen) {
        return;
    }

    const navDrawer = document.getElementById("nav-drawer");
    const menuTrigger = document.getElementById("menu-trigger");
    if (navDrawer?.contains(event.target) || menuTrigger?.contains(event.target)) {
        return;
    }

    setDrawerOpen(false);
}

function handleChromeKeydown(event) {
    if (event.key !== "Escape") {
        return;
    }

    closeGlobalSearchResults();
    if (state.navOpen) {
        setDrawerOpen(false);
    }
}

function openHomeAnchor(anchorId) {
    clearServiceRoute();
    requestAnimationFrame(() => {
        document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
}

function setDrawerOpen(isOpen) {
    state.navOpen = isOpen;

    document.querySelector(".workspace-shell")?.classList.toggle("has-drawer-open", isOpen);
    document.getElementById("nav-drawer")?.classList.toggle("is-open", isOpen);

    const menuTrigger = document.getElementById("menu-trigger");
    menuTrigger?.classList.toggle("is-active", isOpen);
    menuTrigger?.setAttribute("aria-expanded", String(isOpen));
    menuTrigger?.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
}

function handlePopState() {
    syncRouteFromLocation();
    if (!state.services.length) {
        return;
    }

    if (state.route.serviceId) {
        void loadServicePage();
        return;
    }

    state.servicePage = null;
    showHomeView();
    renderCollections();
}

function syncRouteFromLocation() {
    const url = new URL(window.location.href);
    state.route.serviceId = url.searchParams.get("service");
    state.route.resourceId = url.searchParams.get("resourceId");
}

function setRoute(serviceId, resourceId = null, options = {}) {
    const url = new URL(window.location.href);

    if (serviceId) {
        url.searchParams.set("service", serviceId);
    } else {
        url.searchParams.delete("service");
    }

    if (resourceId) {
        url.searchParams.set("resourceId", resourceId);
    } else {
        url.searchParams.delete("resourceId");
    }

    const current = `${window.location.pathname}${window.location.search}`;
    const next = `${url.pathname}${url.search}`;

    state.route.serviceId = serviceId;
    state.route.resourceId = resourceId;

    if (current !== next) {
        const historyMethod = options.replace ? "replaceState" : "pushState";
        window.history[historyMethod]({}, "", next);
    }

    if (!state.services.length) {
        return;
    }

    if (serviceId) {
        void loadServicePage();
        return;
    }

    state.servicePage = null;
    showHomeView();
    renderCollections();
}

function openService(serviceId, resourceId = null, options = {}) {
    const service = getService(serviceId);
    if (!service) {
        return;
    }

    state.selectedServiceId = service.id;
    if (options.trackRecent !== false) {
        recordRecentService(service.id);
    }
    closeGlobalSearchResults();
    setDrawerOpen(false);
    setRoute(service.id, resourceId, options);
}

function clearServiceRoute() {
    setDrawerOpen(false);
    setRoute(null, null);
}

function recordRecentService(serviceId) {
    state.recentServiceIds = [serviceId, ...state.recentServiceIds.filter((id) => id !== serviceId)].slice(0, 10);
    writeRecentServiceIds(state.recentServiceIds);
}

async function loadSummary() {
    try {
        const response = await fetch(summaryUrl, {
            headers: {
                Accept: "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Dashboard data request failed with ${response.status}`);
        }

        const summary = await response.json();
        state.summary = summary;
        state.services = [...summary.services].sort(compareServices);
        state.configuredBaseUrl = summary.configuredBaseUrl;
        state.defaultRegion = summary.defaultRegion;
        state.defaultAccountId = summary.defaultAccountId;
        state.version = summary.version;
        state.selectedServiceId = pickInitialServiceId();

        renderSummary(summary);
        renderCollections();

        if (state.route.serviceId) {
            await loadServicePage();
        } else {
            showHomeView();
        }
    } catch (error) {
        renderMessage(error.message, true);
    }
}

async function loadServicePage() {
    if (!state.route.serviceId) {
        showHomeView();
        return;
    }

    try {
        const url = new URL(`${serviceUrlBase}/${state.route.serviceId}`, window.location.origin);
        if (state.route.resourceId) {
            url.searchParams.set("resourceId", state.route.resourceId);
        }

        const response = await fetch(url, {
            headers: {
                Accept: "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Service page request failed with ${response.status}`);
        }

        state.servicePage = await response.json();
        state.selectedServiceId = state.route.serviceId;
        recordRecentService(state.route.serviceId);
        renderServicePage();
        showServiceView();
    } catch (error) {
        const container = document.getElementById("service-view");
        container.replaceChildren();
        renderMessageInto(container, error.message, true);
        showServiceView();
    }
}

async function postServiceAction(actionId, payload) {
    const serviceId = state.route.serviceId;
    if (!serviceId) {
        return;
    }

    try {
        const response = await fetch(`${serviceUrlBase}/${serviceId}/actions/${actionId}`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || `Action request failed with ${response.status}`);
        }

        state.servicePage = await response.json();
        renderServicePage();
        showServiceView();
    } catch (error) {
        renderMessage(error.message, true);
    }
}

function renderSummary(summary) {
    document.getElementById("region-text").textContent = summary.defaultRegion;
    document.getElementById("account-text").textContent = summary.defaultAccountId;
    document.getElementById("running-count").textContent = String(summary.runningCount);
    document.getElementById("total-count").textContent = String(summary.totalCount);
    document.getElementById("version-text").textContent = summary.version;
    document.getElementById("endpoint-url").textContent = state.endpoint;
    document.getElementById("running-caption").textContent = summary.runningCount === summary.totalCount
        ? "LCS is up and serving every enabled service"
        : `${summary.availableCount} service${summary.availableCount === 1 ? "" : "s"} available but disabled`;
    document.getElementById("available-caption").textContent = `Available services: ${summary.availableCount}`;
    document.getElementById("configured-endpoint-text").textContent = `Configured base URL: ${summary.configuredBaseUrl}`;
    document.getElementById("region-caption").textContent = `Region: ${summary.defaultRegion}`;
}

function renderCollections() {
    const services = filteredServices();
    const runningCount = services.filter((service) => service.status === "running").length;

    document.getElementById("service-summary-text").textContent = `${services.length} service${services.length === 1 ? "" : "s"} in view. ${runningCount} running.`;
    renderShortcuts();
    renderRecentServices();
    renderCategorySections(services);
    updateSelectedServiceIfNeeded();
    renderSelectedService();
    renderNavigationDrawer();
}

function renderNavigationDrawer() {
    const drawerTitle = document.getElementById("nav-drawer-title");
    const drawerContent = document.getElementById("nav-drawer-content");
    if (!drawerTitle || !drawerContent) {
        return;
    }

    drawerTitle.textContent = state.route.serviceId && state.servicePage
        ? `${state.servicePage.displayName} navigation`
        : "Navigation";

    drawerContent.replaceChildren();
    buildNavigationSections()
        .filter((section) => section.items.length)
        .forEach((section) => drawerContent.append(createDrawerSection(section)));
}

function buildNavigationSections() {
    const sections = [
        {
            label: "Console",
            items: [
                {
                    label: "Console home",
                    copy: "Return to the LCS landing page.",
                    active: !state.route.serviceId,
                    action: () => openHomeAnchor("home-overview")
                },
                {
                    label: "All services",
                    copy: "Browse the full service catalog.",
                    action: () => openHomeAnchor("services-panel")
                },
                {
                    label: "Run and CLI",
                    copy: "Jump to emulator start commands and AWS CLI snippets.",
                    action: () => openHomeAnchor("run-widget")
                }
            ]
        }
    ];

    if (state.route.serviceId && state.servicePage) {
        sections.push({
            label: state.servicePage.displayName,
            items: buildServiceNavigationItems(state.servicePage)
        });
    }

    sections.push({
        label: "Quick access",
        items: shortcutCandidates
            .map((serviceId) => getService(serviceId))
            .filter(Boolean)
            .map((service) => ({
                label: humanizeName(service.configKey ?? service.id),
                copy: buildMeta(service),
                active: service.id === state.route.serviceId,
                action: () => openService(service.id)
            }))
    });

    return sections;
}

function buildServiceNavigationItems(page) {
    const items = [
        {
            label: "Overview",
            copy: page.headline,
            action: () => scrollToServiceAnchor("service-hero")
        }
    ];

    if (page.actions?.length) {
        items.push({
            label: "Actions",
            copy: "Primary actions and resource controls.",
            action: () => scrollToServiceAnchor("actions")
        });
    }

    if (page.detailPanes?.length) {
        items.push({
            label: "Resource details",
            copy: "Tabbed resource summary and drill-in panels.",
            action: () => scrollToServiceAnchor("detail-panes")
        });
    }

    (page.tables ?? []).forEach((table) => {
        items.push({
            label: table.title,
            copy: table.description,
            action: () => scrollToServiceAnchor(table.id)
        });
    });

    return items;
}

function createDrawerSection(section) {
    const wrapper = document.createElement("section");
    wrapper.className = "nav-drawer-section";

    const label = document.createElement("p");
    label.className = "nav-drawer-label";
    label.textContent = section.label;
    wrapper.append(label);

    section.items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "nav-drawer-button";
        button.classList.toggle("is-active", Boolean(item.active));
        button.addEventListener("click", item.action);

        const title = document.createElement("strong");
        title.textContent = item.label;

        const copy = document.createElement("span");
        copy.className = "nav-drawer-item-copy";
        copy.textContent = item.copy;

        button.append(title, copy);
        wrapper.append(button);
    });

    return wrapper;
}

function scrollToServiceAnchor(anchorId) {
    const target = document.querySelector(`[data-nav-anchor="${anchorId}"]`);
    if (!target) {
        return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setDrawerOpen(false);
}

function renderShortcuts() {
    const container = document.getElementById("shortcut-list");
    const template = document.getElementById("shortcut-template");
    const shortcuts = shortcutCandidates.map((serviceId) => getService(serviceId)).filter(Boolean);
    const activeId = state.route.serviceId ?? state.selectedServiceId;

    container.replaceChildren();

    shortcuts.forEach((service) => {
        const fragment = template.content.cloneNode(true);
        const button = fragment.querySelector(".shortcut-chip");
        button.classList.toggle("is-active", service.id === activeId);
        button.addEventListener("click", () => openService(service.id));
        button.addEventListener("mouseenter", () => previewService(service.id));
        button.addEventListener("focus", () => previewService(service.id));
        button.querySelector(".shortcut-label").textContent = humanizeName(service.configKey ?? service.id);
        applyServiceIcon(fragment.querySelector(".service-icon"), service);
        container.append(fragment);
    });
}

function renderRecentServices() {
    const grid = document.getElementById("recent-grid");
    const template = document.getElementById("recent-service-template");
    const recentIds = resolvedRecentIds();

    grid.replaceChildren();

    recentIds.forEach((serviceId) => {
        const service = getService(serviceId);
        if (!service) {
            return;
        }

        const fragment = template.content.cloneNode(true);
        const button = fragment.querySelector(".recent-link");
        button.addEventListener("click", () => openService(service.id));
        button.addEventListener("mouseenter", () => previewService(service.id));
        button.addEventListener("focus", () => previewService(service.id));
        fragment.querySelector(".recent-name").textContent = humanizeName(service.configKey ?? service.id);
        fragment.querySelector(".recent-meta").textContent = `${service.status} · ${formatProtocol(service.defaultProtocol ?? "CUSTOM")}`;
        applyServiceIcon(fragment.querySelector(".service-icon"), service);
        grid.append(fragment);
    });

    if (!grid.children.length) {
        renderMessageInto(grid, "No recent services yet. Open a service below.");
    }
}

function renderCategorySections(services) {
    const container = document.getElementById("category-sections");
    container.replaceChildren();

    if (!services.length) {
        renderMessageInto(container, "No services match current filters.");
        return;
    }

    const grouped = groupByCategory(services);

    categoryConfig.forEach((category) => {
        const members = grouped.get(category.id) ?? [];
        if (!members.length) {
            return;
        }

        const card = document.createElement("section");
        card.className = "category-card";
        card.innerHTML = `
            <div class="category-card-head">
                <div>
                    <p class="category-label">${escapeHtml(category.id)}</p>
                    <h3>${escapeHtml(category.label)}</h3>
                </div>
                <span class="detail-pill ${members.every((service) => service.status === "running") ? "running" : "available"}">${members.length} service${members.length === 1 ? "" : "s"}</span>
            </div>
            <p class="widget-copy">${escapeHtml(category.copy)}</p>
        `;

        const tileGrid = document.createElement("div");
        tileGrid.className = "tile-grid";
        members.forEach((service) => tileGrid.append(createServiceTile(service)));
        card.append(tileGrid);
        container.append(card);
    });
}

function createServiceTile(service) {
    const template = document.getElementById("service-tile-template");
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector(".service-tile");
    const tileStatus = fragment.querySelector(".tile-status");

    button.classList.toggle("is-selected", service.id === (state.route.serviceId ?? state.selectedServiceId));
    button.addEventListener("click", () => openService(service.id));
    button.addEventListener("mouseenter", () => previewService(service.id));
    button.addEventListener("focus", () => previewService(service.id));
    fragment.querySelector(".tile-name").textContent = humanizeName(service.configKey ?? service.id);
    fragment.querySelector(".tile-meta").textContent = `${formatProtocol(service.defaultProtocol ?? "CUSTOM")} · ${service.supportsStorage ? service.storageMode ?? "storage" : "no storage"}`;
    tileStatus.textContent = service.status;
    tileStatus.classList.add(service.status);
    applyServiceIcon(fragment.querySelector(".service-icon"), service);

    return fragment;
}

function previewService(serviceId) {
    if (state.route.serviceId) {
        return;
    }

    const service = getService(serviceId);
    if (!service) {
        return;
    }

    state.selectedServiceId = service.id;
    renderSelectedService();
}

function renderSelectedService() {
    const panel = document.getElementById("selected-service-panel");
    const service = getSelectedService();
    panel.replaceChildren();

    if (!service) {
        renderMessageInto(panel, "Choose a service to inspect how the local console exposes it.");
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "selected-body";
    const cliCommand = resolveCliCommand(service);

    wrapper.innerHTML = `
        <div class="selected-head">
            <span class="service-icon" style="--service-color: ${escapeHtml(colorForService(service))}"></span>
            <div class="selected-copy">
                <p class="service-id">${escapeHtml(service.id)}</p>
                <h3>${escapeHtml(humanizeName(service.configKey ?? service.id))}</h3>
                <p class="body-copy">${escapeHtml(buildMeta(service))}</p>
            </div>
            <span class="detail-pill ${escapeHtml(service.status)}">${escapeHtml(service.status)}</span>
        </div>
        <div class="detail-grid">
            <div class="detail-row">
                <span class="detail-label">CLI namespace</span>
                <strong>${escapeHtml(resolveCliNamespace(service))}</strong>
            </div>
            <div class="detail-row">
                <span class="detail-label">Default protocol</span>
                <strong>${escapeHtml(formatProtocol(service.defaultProtocol ?? "CUSTOM"))}</strong>
            </div>
            <div class="detail-row">
                <span class="detail-label">Storage</span>
                <strong>${escapeHtml(service.supportsStorage ? service.storageMode ?? "configured" : "no local storage")}</strong>
            </div>
            <div class="detail-row">
                <span class="detail-label">Scopes</span>
                <strong>${escapeHtml(service.credentialScopes.length ? service.credentialScopes.join(", ") : "n/a")}</strong>
            </div>
        </div>
        <div class="selected-badges"></div>
        <div class="selected-actions"></div>
        <div class="snippet-card">
            <h3>CLI example</h3>
            <pre><code>${escapeHtml(cliCommand)}</code></pre>
        </div>
    `;

    const badgeContainer = wrapper.querySelector(".selected-badges");
    service.supportedProtocols.forEach((protocol) => badgeContainer.append(createBadge(formatProtocol(protocol), "protocol")));

    if (service.supportsStorage) {
        badgeContainer.append(createBadge(`Storage ${service.storageMode ?? "configured"}`, "storage"));
    } else {
        badgeContainer.append(createBadge("No local storage", "storage"));
    }

    service.credentialScopes.forEach((scope) => badgeContainer.append(createBadge(`Scope ${scope}`, "scope")));

    const actionRow = wrapper.querySelector(".selected-actions");
    const openButton = document.createElement("button");
    openButton.className = "primary-button";
    openButton.type = "button";
    openButton.textContent = `Open ${humanizeName(service.configKey ?? service.id)} console`;
    openButton.addEventListener("click", () => openService(service.id));
    actionRow.append(openButton);

    panel.append(wrapper);
    document.getElementById("aws-command").textContent = cliCommand;
    document.getElementById("protocol-note").textContent = protocolNote(service);
}

function renderServicePage() {
    const container = document.getElementById("service-view");
    container.replaceChildren();

    if (!state.servicePage) {
        renderMessageInto(container, "Loading service console...");
        return;
    }

    const page = state.servicePage;
    const shell = document.createElement("div");
    shell.className = `service-page-shell shell-${page.shell}`;
    shell.append(createServiceHero(page));

    const notices = (page.notices ?? []).filter(shouldRenderNotice);
    if (notices.length) {
        shell.append(createNoticeSection(notices));
    }

    if (page.metrics?.length) {
        shell.append(createMetricSection(page.metrics));
    }

    if (page.actions?.length) {
        shell.append(createActionsSection(page.actions));
    }

    if (page.detailPanes?.length) {
        shell.append(createDetailPaneSection(page.detailPanes));
    }

    if (page.tables?.length) {
        page.tables.forEach((table) => shell.append(createTableSection(table)));
    }

    container.append(shell);
    renderNavigationDrawer();
}

function shouldRenderNotice(notice) {
    return /^(Created|Started|Stopped|Terminated|Allocated|Associated|Disassociated|Released|Deleted|Uploaded|Invocation result|Attached|Added|Updated|Put|Launched)\b/.test(notice ?? "");
}

function createServiceHero(page) {
    const section = document.createElement("section");
    section.className = "widget service-hero";
    section.dataset.navAnchor = "service-hero";

    const rawJsonUrl = buildServiceJsonUrl(page.serviceId, state.route.resourceId);
    section.innerHTML = `
        <div class="service-hero-top">
            <button class="link-button back-home-button" type="button">Console home</button>
            <div class="head-actions">
                <a class="outline-button" href="${escapeHtml(rawJsonUrl)}" target="_blank" rel="noreferrer">Service JSON</a>
                <button class="outline-button service-refresh-button" type="button">Refresh</button>
            </div>
        </div>
        <div class="service-hero-main">
            <div>
                <p class="console-kicker">LCS / ${escapeHtml(page.displayName)}</p>
                <h1>${escapeHtml(page.headline)}</h1>
                <p class="console-copy">${escapeHtml(page.subheadline)}</p>
            </div>
            <span class="detail-pill ${escapeHtml(page.status)}">${escapeHtml(page.status)}</span>
        </div>
        <div class="service-hero-foot">
            <article class="snippet-card wide">
                <h3>AWS CLI</h3>
                <pre><code>${escapeHtml(resolveCliCommandForPage(page))}</code></pre>
            </article>
        </div>
    `;

    section.querySelector(".back-home-button").addEventListener("click", () => clearServiceRoute());
    section.querySelector(".service-refresh-button").addEventListener("click", () => {
        void loadServicePage();
    });

    return section;
}

function createNoticeSection(notices) {
    const section = document.createElement("section");
    section.className = "service-notices";

    notices.forEach((notice) => {
        const article = document.createElement("article");
        article.className = "widget notice-card";
        const paragraph = document.createElement("p");
        paragraph.textContent = notice;
        article.append(paragraph);
        section.append(article);
    });

    return section;
}

function createMetricSection(metrics) {
    const section = document.createElement("section");
    section.className = "widget summary-widget";
    const grid = document.createElement("div");
    grid.className = "summary-grid service-summary-grid";

    metrics.forEach((metric) => {
        const card = document.createElement("article");
        card.className = "summary-card";
        if (metric.tone === "running" || metric.tone === "primary") {
            card.classList.add("highlight");
        }

        const label = document.createElement("span");
        label.className = "card-label";
        label.textContent = metric.label;

        const value = document.createElement("strong");
        value.textContent = metric.value;

        const copy = document.createElement("p");
        copy.textContent = metric.description;

        card.append(label, value, copy);
        grid.append(card);
    });

    section.append(grid);
    return section;
}

function createActionsSection(actions) {
    const section = document.createElement("section");
    section.className = "service-actions-grid";
    section.dataset.navAnchor = "actions";

    actions.forEach((action) => {
        const card = document.createElement("section");
        card.className = "widget action-card";

        const head = document.createElement("div");
        head.className = "widget-head compact";
        const headCopy = document.createElement("div");
        const title = document.createElement("h2");
        title.textContent = action.label;
        const copy = document.createElement("p");
        copy.className = "widget-copy";
        copy.textContent = action.tone === "primary"
            ? "Primary flow for this service."
            : "Management action against the selected service state.";
        headCopy.append(title, copy);
        head.append(headCopy);

        const form = document.createElement("form");
        form.className = "action-form";
        form.dataset.actionId = action.id;
        form.addEventListener("submit", submitActionForm);

        action.fields.forEach((field) => {
            form.append(createActionField(field));
        });

        const submit = document.createElement("button");
        submit.className = action.tone === "primary" ? "primary-button" : "outline-button";
        submit.type = "submit";
        submit.textContent = action.label;

        form.append(submit);
        card.append(head, form);
        section.append(card);
    });

    return section;
}

function createDetailPaneSection(detailPanes) {
    const section = document.createElement("section");
    section.className = "widget detail-pane-widget";
    section.dataset.navAnchor = "detail-panes";

    const head = document.createElement("div");
    head.className = "widget-head compact";
    head.innerHTML = `
        <div>
            <h2>Resource details</h2>
            <p class="widget-copy">Modeled after the AWS EC2 detail view: summary groups behind service-native tabs.</p>
        </div>
    `;

    const tabBar = document.createElement("div");
    tabBar.className = "detail-tab-bar";
    const content = document.createElement("div");
    content.className = "detail-pane-body";

    let activePaneId = detailPanes[0]?.id ?? null;

    function renderActivePane() {
        const activePane = detailPanes.find((pane) => pane.id === activePaneId) ?? detailPanes[0];
        content.replaceChildren();

        if (!activePane) {
            return;
        }

        const groupGrid = document.createElement("div");
        groupGrid.className = "detail-group-grid";

        activePane.groups.forEach((group) => {
            const groupCard = document.createElement("article");
            groupCard.className = "detail-group-card";

            const title = document.createElement("h3");
            title.textContent = group.title;
            groupCard.append(title);

            const itemGrid = document.createElement("div");
            itemGrid.className = "detail-item-grid";

            group.items.forEach((item) => {
                const itemNode = document.createElement("div");
                itemNode.className = "detail-item";

                const label = document.createElement("span");
                label.className = "detail-label";
                label.textContent = item.label;

                const value = document.createElement("strong");
                value.className = `detail-value ${item.tone || "neutral"}`;
                value.textContent = item.value;

                itemNode.append(label, value);
                itemGrid.append(itemNode);
            });

            groupCard.append(itemGrid);
            groupGrid.append(groupCard);
        });

        content.append(groupGrid);
    }

    detailPanes.forEach((pane) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "detail-tab-button";
        button.textContent = pane.label;
        button.addEventListener("click", () => {
            activePaneId = pane.id;
            tabBar.querySelectorAll(".detail-tab-button").forEach((node) => {
                node.classList.toggle("is-active", node === button);
            });
            renderActivePane();
        });
        button.classList.toggle("is-active", pane.id === activePaneId);
        tabBar.append(button);
    });

    renderActivePane();
    section.append(head, tabBar, content);
    return section;
}

function createActionField(field) {
    if (field.name === "resourceId") {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = field.name;
        hidden.value = field.defaultValue ?? "";
        return hidden;
    }

    const wrapper = document.createElement("label");
    wrapper.className = "field-control";

    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = field.label;
    wrapper.append(label);

    let control;

    if (field.type === "select") {
        control = document.createElement("select");
        field.options.forEach((option) => {
            const node = document.createElement("option");
            node.value = option.value;
            node.textContent = option.label;
            if (option.value === field.defaultValue) {
                node.selected = true;
            }
            control.append(node);
        });
    } else if (field.type === "textarea") {
        control = document.createElement("textarea");
        control.rows = 5;
        control.value = field.defaultValue ?? "";
    } else {
        control = document.createElement("input");
        control.type = field.type || "text";
        control.value = field.defaultValue ?? "";
        if (field.placeholder) {
            control.placeholder = field.placeholder;
        }
    }

    control.name = field.name;
    control.required = Boolean(field.required);
    wrapper.append(control);
    return wrapper;
}

function createTableSection(table) {
    const section = document.createElement("section");
    section.className = "widget table-widget";
    section.dataset.navAnchor = table.id;

    const head = document.createElement("div");
    head.className = "widget-head compact";
    const copy = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = table.title;
    const description = document.createElement("p");
    description.className = "widget-copy";
    description.textContent = table.description;
    copy.append(title, description);
    head.append(copy);
    section.append(head);

    if (!table.rows.length) {
        const empty = document.createElement("div");
        empty.className = "table-empty";
        empty.textContent = table.emptyMessage;
        section.append(empty);
        return section;
    }

    const hasActions = table.rows.some((row) => row.actions?.length);
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    const tableNode = document.createElement("table");
    tableNode.className = "service-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    table.columns.forEach((column) => {
        const th = document.createElement("th");
        th.textContent = column;
        headRow.append(th);
    });
    if (hasActions) {
        const th = document.createElement("th");
        th.textContent = "Actions";
        headRow.append(th);
    }
    thead.append(headRow);

    const tbody = document.createElement("tbody");
    table.rows.forEach((row) => {
        const tr = document.createElement("tr");
        row.cells.forEach((cell, index) => {
            const td = document.createElement("td");
            if (row.linkCellIndex === index) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "table-link";
                button.textContent = cell;
                button.addEventListener("click", () => handleRowAction("open-resource", row.id));
                td.append(button);
            } else {
                td.textContent = cell;
            }
            tr.append(td);
        });

        if (hasActions) {
            const actionsTd = document.createElement("td");
            actionsTd.className = "table-actions";
            (row.actions ?? []).forEach((action) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = `row-action ${action.tone || "secondary"}`;
                button.textContent = action.label;
                button.addEventListener("click", () => handleRowAction(action.id, row.id));
                actionsTd.append(button);
            });
            tr.append(actionsTd);
        }

        tbody.append(tr);
    });

    tableNode.append(thead, tbody);
    scroll.append(tableNode);
    section.append(scroll);
    return section;
}

async function submitActionForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    await postServiceAction(form.dataset.actionId, payload);
}

function handleRowAction(actionId, rowId) {
    if (actionId === "open-resource") {
        setRoute(state.route.serviceId, rowId);
        return;
    }

    void postServiceAction(actionId, { resourceId: rowId });
}

function showHomeView() {
    document.getElementById("home-view").classList.remove("is-hidden");
    document.getElementById("service-view").classList.add("is-hidden");
    document.title = "LCS Console";
    updateNavMode(false);
}

function showServiceView() {
    document.getElementById("home-view").classList.add("is-hidden");
    document.getElementById("service-view").classList.remove("is-hidden");
    document.title = `${state.servicePage?.displayName ?? "Service"} · LCS Console`;
    updateNavMode(true);
}

function updateNavMode(isServiceView) {
    document.querySelectorAll(".nav-icon").forEach((button) => button.classList.remove("is-active"));
    const activeLabel = isServiceView ? "Services" : "Console home";
    document.querySelector(`.nav-icon[aria-label="${activeLabel}"]`)?.classList.add("is-active");
}

function syncSearch(value) {
    state.query = value.trim().toLowerCase();
    document.getElementById("global-search").value = value;
    document.getElementById("service-search").value = value;
    renderGlobalSearchResults();

    if (!state.route.serviceId) {
        renderCollections();
    }
}

function renderGlobalSearchResults() {
    const container = document.getElementById("global-search-results");
    if (!container) {
        return;
    }

    container.replaceChildren();

    if (!state.query) {
        closeGlobalSearchResults();
        return;
    }

    const matches = topSearchMatches();
    if (!matches.length) {
        const empty = document.createElement("div");
        empty.className = "search-result-empty";
        empty.textContent = `No services match \"${state.query}\".`;
        container.append(empty);
        container.classList.remove("is-hidden");
        return;
    }

    matches.forEach((service) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result";
        button.addEventListener("click", () => openService(service.id));

        const title = document.createElement("strong");
        title.textContent = humanizeName(service.configKey ?? service.id);

        const meta = document.createElement("span");
        meta.className = "search-result-meta";
        meta.textContent = buildMeta(service);

        button.append(title, meta);
        container.append(button);
    });

    container.classList.remove("is-hidden");
}

function closeGlobalSearchResults() {
    document.getElementById("global-search-results")?.classList.add("is-hidden");
}

function topSearchMatches() {
    if (!state.query) {
        return [];
    }

    return state.services.filter((service) => matchesQuery(service)).slice(0, 8);
}

function filteredServices() {
    return state.services.filter((service) => matchesStatus(service) && matchesQuery(service));
}

function matchesStatus(service) {
    return state.status === "all" || service.status === state.status;
}

function matchesQuery(service) {
    if (!state.query) {
        return true;
    }

    const haystack = [
        service.id,
        service.configKey,
        humanizeName(service.configKey ?? service.id),
        service.defaultProtocol,
        ...(service.supportedProtocols ?? []),
        ...(service.credentialScopes ?? []),
        service.storageMode,
        categoryForService(service).label
    ].filter(Boolean).join(" ").toLowerCase();

    return haystack.includes(state.query);
}

function groupByCategory(services) {
    const grouped = new Map(categoryConfig.map((category) => [category.id, []]));
    services.forEach((service) => {
        grouped.get(categoryForService(service).id).push(service);
    });
    return grouped;
}

function resolvedRecentIds() {
    const merged = [...state.recentServiceIds, ...fallbackRecentIds];
    return [...new Set(merged)]
        .map((serviceId) => getService(serviceId))
        .filter(Boolean)
        .map((service) => service.id)
        .slice(0, 10);
}

function pickInitialServiceId() {
    if (state.route.serviceId && getService(state.route.serviceId)) {
        return state.route.serviceId;
    }

    return resolvedRecentIds()[0] ?? state.services[0]?.id ?? null;
}

function updateSelectedServiceIfNeeded() {
    if (!state.selectedServiceId || !getService(state.selectedServiceId)) {
        state.selectedServiceId = pickInitialServiceId();
    }
}

function getService(serviceId) {
    return state.services.find((service) => service.id === serviceId || service.configKey === serviceId) ?? null;
}

function getSelectedService() {
    return getService(state.selectedServiceId);
}

function categoryForService(service) {
    const keys = [service.configKey, service.id].filter(Boolean);
    return categoryConfig.find((category) => keys.some((key) => category.keys.includes(key))) ?? categoryConfig[categoryConfig.length - 1];
}

function compareServices(left, right) {
    const leftShortcut = shortcutCandidates.indexOf(left.id);
    const rightShortcut = shortcutCandidates.indexOf(right.id);

    if (leftShortcut >= 0 || rightShortcut >= 0) {
        if (leftShortcut === -1) {
            return 1;
        }
        if (rightShortcut === -1) {
            return -1;
        }
        return leftShortcut - rightShortcut;
    }

    return humanizeName(left.configKey ?? left.id).localeCompare(humanizeName(right.configKey ?? right.id));
}

function humanizeName(serviceId) {
    return nameOverrides[serviceId] ?? serviceId
        .split("-")
        .map((segment) => segment ? segment[0].toUpperCase() + segment.slice(1) : segment)
        .join(" ");
}

function formatProtocol(protocol) {
    switch (protocol) {
        case "QUERY":
            return "QUERY";
        case "JSON":
            return "JSON";
        case "CBOR":
            return "CBOR";
        case "REST_JSON":
            return "REST JSON";
        case "REST_XML":
            return "REST XML";
        default:
            return protocol || "CUSTOM";
    }
}

function resolveCliNamespace(service) {
    const key = service.id === "email" ? "ses" : service.id;
    return key === "states" ? "stepfunctions" : key;
}

function resolveCliCommand(service) {
    const template = commandExamples[service.id] ?? commandExamples[service.configKey] ?? `aws --endpoint-url {endpoint} ${resolveCliNamespace(service)} help`;
    return template.replaceAll("{endpoint}", state.configuredBaseUrl || state.endpoint);
}

function resolveCliCommandForPage(page) {
    const service = getService(page.serviceId) ?? { id: page.serviceId, configKey: page.serviceId };
    return resolveCliCommand(service);
}

function protocolNote(service) {
    const protocol = service.defaultProtocol ?? "CUSTOM";

    if (protocol === "QUERY") {
        return "AWS Query services use form-encoded POST actions and XML responses. Browser console actions proxy through the emulator instead of issuing raw query requests directly.";
    }
    if (protocol === "JSON") {
        return "AWS JSON services use X-Amz-Target and AWS JSON payloads. Console actions call the browser-safe console layer, which then executes the real service methods.";
    }
    if (protocol === "REST_JSON") {
        return "REST JSON services map more naturally to browser concepts. This console still routes through the console API so forms can stay simple and deterministic.";
    }
    if (protocol === "REST_XML") {
        return "REST XML services like S3 speak plain HTTP verbs, but the console still proxies via the console API to support dynamic listings and simplified text upload actions.";
    }
    return "This service does not use a single common browser-friendly wire shape, so the console leans on the emulator's service adapter layer.";
}

function buildMeta(service) {
    const protocol = formatProtocol(service.defaultProtocol ?? "CUSTOM");
    const storage = service.supportsStorage ? service.storageMode ?? "configured" : "no local storage";
    return `${protocol} · ${storage}`;
}

function createBadge(label, kind) {
    const badge = document.createElement("span");
    badge.className = `detail-badge ${kind}`;
    badge.textContent = label;
    return badge;
}

function colorForService(service) {
    const palette = ["#ff9900", "#11a4ff", "#2fb980", "#f2735d", "#f2bb46", "#7ac3ff"];
    const key = `${service.id ?? service.serviceId ?? "service"}`;
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
        hash = ((hash << 5) - hash + key.charCodeAt(index)) >>> 0;
    }
    return palette[hash % palette.length];
}

function applyServiceIcon(element, service) {
    element.style.setProperty("--service-color", colorForService(service));
    element.textContent = initialsForService(service);
}

function initialsForService(service) {
    const label = humanizeName(service.configKey ?? service.id);
    return label.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function buildServiceJsonUrl(serviceId, resourceId) {
    const url = new URL(`${serviceUrlBase}/${serviceId}`, window.location.origin);
    if (resourceId) {
        url.searchParams.set("resourceId", resourceId);
    }
    return `${url.pathname}${url.search}`;
}

function renderMessage(message, isError = false) {
    const target = state.route.serviceId ? document.getElementById("service-view") : document.getElementById("selected-service-panel");
    target.replaceChildren();
    renderMessageInto(target, message, isError);
}

function renderMessageInto(container, message, isError = false) {
    const card = document.createElement("div");
    card.className = `empty-state ${isError ? "is-error" : ""}`;
    card.textContent = message;
    container.append(card);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function readRecentServiceIds() {
    try {
        const raw = window.localStorage.getItem(recentStorageKey);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
    } catch {
        return [];
    }
}

function writeRecentServiceIds(serviceIds) {
    window.localStorage.setItem(recentStorageKey, JSON.stringify(serviceIds));
}