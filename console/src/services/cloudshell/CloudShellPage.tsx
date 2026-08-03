import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

import { useEmulator } from "@platform/EmulatorContext";
import { useNotifications } from "@shell/NotificationContext";
import { XtermView } from "./XtermView";
import type { SessionState } from "./session";
import {
  deleteSession,
  downloadFile,
  fetchStatus,
  restartSession,
  uploadFile,
} from "./api";
import type { CloudShellStatus } from "./api";

type SplitMode = "none" | "rows" | "columns";

interface TabState {
  id: string;
  title: string;
  state: SessionState;
  message?: string;
  /**
   * Bumped to force the terminal to remount and reconnect without changing the session id.
   * Restart replaces the container behind the same session, so the old socket is dead but
   * the identity — and therefore the home volume and the audit stream — is unchanged.
   */
  epoch: number;
}

const WELCOME_KEY = "lcs.cloudshell.welcomeDismissed";
const SESSION_KEY = "lcs.cloudshell.sessionId";

/**
 * The id of this browser's primary session, minted once and remembered.
 *
 * Without this every visit to the page would start a *new* session, and since a session is
 * a container, each visit would build another one and abandon the last to the idle reaper —
 * exhausting the session cap in a handful of page loads. AWS CloudShell puts you back in
 * the environment you left; keeping the id stable is what makes that true here.
 */
function primarySessionId(): string {
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored !== null && stored !== "") {
    return stored;
  }
  const minted = `cs-${Date.now()}-primary`;
  localStorage.setItem(SESSION_KEY, minted);
  return minted;
}

/**
 * AWS CloudShell, reproduced in the LCS console.
 *
 * Layout mirrors AWS: a title row ("CloudShell" + Actions dropdown + settings), a tab
 * strip whose tabs are named by Region, and the terminal area below. Terminals are
 * xterm.js bound to the LCS terminal gateway over a WebSocket (see session.ts), which
 * bridges to a shell running in a per-session container.
 *
 * When the backend reports itself unavailable — CloudShell disabled, or LCS running
 * without the Docker socket — the terminal runs an in-browser preview shell showing the
 * backend's own reason, and the actions that need a real container are disabled rather
 * than silently doing nothing.
 */
export default function CloudShellPage() {
  const { region, effectiveAccountId } = useEmulator();
  const { notify } = useNotifications();
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState("");
  const [split, setSplit] = useState<SplitMode>("none");
  const [fullscreen, setFullscreen] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [status, setStatus] = useState<CloudShellStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadPath, setDownloadPath] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  // The terminal cannot be created until we know whether a real one is available: the
  // preview shell and the gateway are different transports, and switching after mount
  // would tear the terminal down and lose its scrollback.
  const backendAvailable = status?.available ?? false;

  const makeTab = useCallback((id?: string): TabState => {
    counter.current += 1;
    return {
      // Also the container name suffix and the audit log stream, so it stays within the
      // gateway's [A-Za-z0-9_-] session-id rule.
      id: id ?? `cs-${Date.now()}-${counter.current}`,
      // AWS titles each tab by the Region it runs in.
      title: region,
      state: "connecting",
      epoch: 0,
    };
  }, [region]);

  // Probe the backend, then reopen this browser's session. Welcome dialog on first visit.
  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then((next) => {
      if (cancelled) {
        return;
      }
      setStatus(next);
      // The remembered id reattaches to the container left running from the last visit,
      // rather than starting a second one beside it.
      const first = makeTab(primarySessionId());
      setTabs([first]);
      setActiveId(first.id);
    });
    if (localStorage.getItem(WELCOME_KEY) !== "true") {
      setWelcome(true);
    }
    return () => {
      cancelled = true;
    };
    // Region is captured once for the initial tab; new tabs pick up the live Region.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const setTabState = useCallback((id: string, state: SessionState, message?: string) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, state, message } : tab)));
  }, []);

  const addTab = () => {
    const tab = makeTab();
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  };

  const closeTab = (id: string) => {
    if (tabs.length === 1) {
      return; // AWS keeps at least one session open, so there is nothing to close.
    }
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeId) {
        setActiveId(next[next.length - 1].id);
      }
      return next;
    });
    if (localStorage.getItem(SESSION_KEY) === id) {
      // This browser's remembered session is gone; the next visit mints a new one rather
      // than trying to reattach to a container that no longer exists.
      localStorage.removeItem(SESSION_KEY);
    }
    if (backendAvailable) {
      // Closing the socket only detaches. The container *is* the session, so an explicitly
      // closed tab has to end it, or it lingers until the idle reaper.
      void deleteSession(id).catch(() => undefined);
    }
  };

  /**
   * AWS's "Delete" action removes the environment itself, not just the tab: the container
   * goes, and you are handed a fresh one. (The home directory is a volume and survives —
   * deleting an environment is not meant to destroy the user's files.)
   */
  const deleteEnvironment = () => {
    if (!active) {
      return;
    }
    const doomed = active.id;
    if (localStorage.getItem(SESSION_KEY) === doomed) {
      localStorage.removeItem(SESSION_KEY);
    }
    if (tabs.length === 1) {
      // Last tab: hand back a fresh environment rather than an empty page.
      const replacement = makeTab(primarySessionId());
      setTabs([replacement]);
      setActiveId(replacement.id);
    } else {
      const remaining = tabs.filter((tab) => tab.id !== doomed);
      setTabs(remaining);
      setActiveId(remaining[remaining.length - 1].id);
    }
    if (backendAvailable) {
      void deleteSession(doomed)
        .then(() => notify({ type: "success", content: "Environment deleted. A new one is starting." }))
        .catch((error: unknown) =>
          notify({
            type: "error",
            header: "Delete failed",
            content: error instanceof Error ? error.message : String(error),
          }),
        );
    }
  };

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  };

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Ending every open session on unmount would kill the shell on a stray navigation, so
  // sessions deliberately survive leaving the page and are reclaimed by the idle reaper.

  const onUploadPicked = (files: FileList | null) => {
    if (!files || files.length === 0 || !active) {
      return;
    }
    const file = files[0];
    uploadFile(active.id, file)
      .then((path) => notify({ type: "success", header: "Upload complete", content: `${file.name} → ${path}` }))
      .catch((error: unknown) =>
        notify({
          type: "error",
          header: "Upload failed",
          content: error instanceof Error ? error.message : String(error),
        }),
      );
    // Allow re-picking the same file.
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const runDownload = () => {
    if (!active || downloadPath.trim() === "") {
      return;
    }
    const path = downloadPath.trim();
    setDownloadOpen(false);
    downloadFile(active.id, path).catch((error: unknown) =>
      notify({
        type: "error",
        header: "Download failed",
        content: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  const restartActive = () => {
    if (!active) {
      return;
    }
    restartSession(active.id, region, effectiveAccountId)
      .then(() => {
        notify({ type: "success", content: "Session restarted in a fresh container." });
        // The container is new, so the old socket is dead. Bump the epoch to remount the
        // terminal; the session id is unchanged, so the home directory comes back with it.
        setTabs((current) =>
          current.map((tab) => (tab.id === active.id ? { ...tab, epoch: tab.epoch + 1 } : tab)),
        );
      })
      .catch((error: unknown) =>
        notify({
          type: "error",
          header: "Restart failed",
          content: error instanceof Error ? error.message : String(error),
        }),
      );
  };

  const onAction = (id: string) => {
    switch (id) {
      case "new-tab":
        addTab();
        break;
      case "split-rows":
        setSplit("rows");
        break;
      case "split-columns":
        setSplit("columns");
        break;
      case "merge":
        setSplit("none");
        break;
      case "upload":
        fileInputRef.current?.click();
        break;
      case "download":
        setDownloadPath("");
        setDownloadOpen(true);
        break;
      case "restart":
        restartActive();
        break;
      case "delete":
        deleteEnvironment();
        break;
      case "vpc-env":
        notify({
          type: "info",
          content:
            "VPC environments place the shell inside a VPC's networking. LCS models VPCs as "
            + "metadata, not as real networks, so there is nothing to place it in.",
        });
        break;
      default:
        break;
    }
  };

  const dismissWelcome = () => {
    if (dontShow) {
      localStorage.setItem(WELCOME_KEY, "true");
    }
    setWelcome(false);
  };

  const shown = split === "none" ? (active ? [active] : []) : tabs.slice(0, 2);
  // Actions that need a real container. Offering them against the preview shell would be
  // offering something that cannot work.
  const containerActionsDisabled = !backendAvailable;

  return (
    <div ref={rootRef} style={{ height: fullscreen ? "100vh" : "calc(100vh - 130px)", display: "flex", flexDirection: "column" }}>
      <Header
        variant="h1"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <ButtonDropdown
              items={[
                {
                  id: "env",
                  text: `${region} environment actions`,
                  items: [
                    { id: "new-tab", text: "New tab" },
                    { id: "split-rows", text: "Split into rows" },
                    { id: "split-columns", text: "Split into columns" },
                    ...(split !== "none" ? [{ id: "merge", text: "Merge terminals" }] : []),
                    { id: "download", text: "Download file", disabled: containerActionsDisabled },
                    { id: "upload", text: "Upload file", disabled: containerActionsDisabled },
                    { id: "restart", text: "Restart", disabled: containerActionsDisabled },
                    { id: "delete", text: "Delete", disabled: containerActionsDisabled },
                  ],
                },
                {
                  id: "global",
                  text: "Global actions",
                  items: [{ id: "vpc-env", text: "Create VPC environment (max 2)", disabled: true }],
                },
              ]}
              onItemClick={(event) => onAction(event.detail.id)}
            >
              Actions
            </ButtonDropdown>
            <Button
              iconName={fullscreen ? "exit-full-screen" : "full-screen"}
              variant="icon"
              ariaLabel={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={toggleFullscreen}
            />
            <Button
              iconName="settings"
              variant="icon"
              ariaLabel="Settings"
              onClick={() => setSettingsOpen(true)}
            />
          </SpaceBetween>
        }
      >
        CloudShell
      </Header>

      {status !== null && !status.available && (
        <Box padding={{ bottom: "xs" }}>
          <Alert type="warning" header="Running the preview shell">
            {status.reason ?? "The CloudShell backend is not available."}
          </Alert>
        </Box>
      )}

      {/* Tab strip: region-named tabs + new-tab button, AWS style. */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 0", borderBottom: "1px solid var(--awsui-color-border-divider-default, #24374f)" }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveId(tab.id)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer", borderBottom: tab.id === activeId ? "2px solid #539fe5" : "2px solid transparent" }}
          >
            <StatusIndicator type={tab.state === "ready" ? "success" : tab.state === "closed" ? "stopped" : "in-progress"}>
              <span style={{ fontSize: 13 }}>{tab.title}</span>
            </StatusIndicator>
            {tabs.length > 1 && (
              <span onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} aria-label={`Close ${tab.title}`} style={{ opacity: 0.6 }}>✕</span>
            )}
          </div>
        ))}
        <Button iconName="add-plus" variant="inline-icon" ariaLabel="New tab" onClick={addTab} />
      </div>

      {/* Terminal area. */}
      <div style={{ flex: 1, display: "flex", flexDirection: split === "rows" ? "column" : "row", minHeight: 0, background: "#0f1b2d", borderRadius: 6, marginTop: 8 }}>
        {shown.map((tab) => (
          <div
            // The epoch is part of the key so Restart remounts the terminal.
            key={`${tab.id}:${tab.epoch}`}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              padding: 8,
              borderRight: split === "columns" ? "1px solid #24374f" : undefined,
              borderBottom: split === "rows" ? "1px solid #24374f" : undefined,
            }}
          >
            <XtermView
              sessionId={tab.id}
              useSim={!backendAvailable}
              simReason={status?.reason ?? undefined}
              region={region}
              account={effectiveAccountId}
              onState={(state, message) => setTabState(tab.id, state, message)}
            />
          </div>
        ))}
      </div>

      <input
        ref={fileInputRef}
        id="cloudshell-upload"
        name="cloudshell-upload"
        type="file"
        aria-label="Upload file to CloudShell"
        style={{ display: "none" }}
        onChange={(event) => onUploadPicked(event.target.files)}
      />

      <Modal
        visible={downloadOpen}
        onDismiss={() => setDownloadOpen(false)}
        header="Download file"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDownloadOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={runDownload} disabled={downloadPath.trim() === ""}>
                Download
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField
          label="File path"
          description={`Absolute path, or a name relative to ${status?.homeDirectory ?? "your home directory"}.`}
        >
          <Input
            value={downloadPath}
            placeholder="report.txt"
            onChange={(event) => setDownloadPath(event.detail.value)}
          />
        </FormField>
      </Modal>

      <Modal
        visible={settingsOpen}
        onDismiss={() => setSettingsOpen(false)}
        header="CloudShell settings"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => setSettingsOpen(false)}>Close</Button>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box color="text-body-secondary">
            These are set on the LCS process, under <code>floci.services.cloudshell</code>.
          </Box>
          <KeyValuePairs
            columns={2}
            items={[
              { label: "Status", value: backendAvailable ? "Available" : (status?.reason ?? "Unavailable") },
              { label: "Tools image", value: status?.image || "—" },
              { label: "Fallback image", value: status?.fallbackImage || "—" },
              { label: "Home directory", value: status?.homeDirectory || "—" },
              {
                label: "Idle timeout",
                value: status ? `${Math.round(status.idleTimeoutSeconds / 60)} minutes` : "—",
              },
              {
                label: "Session timeout",
                value: status ? `${Math.round(status.sessionTimeoutSeconds / 3600)} hours` : "—",
              },
              { label: "Open sessions", value: status ? `${status.sessions.length} of ${status.maxSessions}` : "—" },
            ]}
          />
        </SpaceBetween>
      </Modal>

      <Modal
        visible={welcome}
        onDismiss={dismissWelcome}
        header="Welcome to LCS CloudShell"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={dismissWelcome}>Close</Button>
          </Box>
        }
      >
        <SpaceBetween size="l">
          <Box>
            LCS CloudShell is a browser-based shell that gives you command-line access to your
            LCS resources in the selected Region. It comes pre-installed with popular tools and
            uses temporary credentials minted for your console identity.
          </Box>
          <ColumnLayout columns={3} variant="text-grid">
            <SpaceBetween size="xs">
              <Box variant="strong">Pre-installed tools</Box>
              <Box color="text-body-secondary">AWS CLI, Terraform, kubectl, Python, Node.js</Box>
            </SpaceBetween>
            <SpaceBetween size="xs">
              <Box variant="strong">Storage included</Box>
              <Box color="text-body-secondary">Persistent home directory per Region</Box>
            </SpaceBetween>
            <SpaceBetween size="xs">
              <Box variant="strong">Saved files and settings</Box>
              <Box color="text-body-secondary">Files in your home directory persist to future sessions</Box>
            </SpaceBetween>
          </ColumnLayout>
          <Checkbox checked={dontShow} onChange={(event) => setDontShow(event.detail.checked)}>
            Do not show again
          </Checkbox>
        </SpaceBetween>
      </Modal>
    </div>
  );
}
