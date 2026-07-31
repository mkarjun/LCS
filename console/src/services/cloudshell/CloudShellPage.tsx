import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Checkbox from "@cloudscape-design/components/checkbox";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

import { useEmulator } from "@platform/EmulatorContext";
import { useNotifications } from "@shell/NotificationContext";
import { XtermView } from "./XtermView";
import type { XtermHandle } from "./XtermView";
import type { SessionState } from "./session";

type SplitMode = "none" | "rows" | "columns";

interface TabState {
  id: string;
  title: string;
  state: SessionState;
  message?: string;
}

const WELCOME_KEY = "lcs.cloudshell.welcomeDismissed";

/**
 * AWS CloudShell, reproduced in the LCS console.
 *
 * Layout mirrors AWS: a title row ("CloudShell" + Actions dropdown + settings), a tab
 * strip whose tabs are named by Region, and the terminal area below. First visit shows the
 * AWS welcome dialog. Terminals are xterm.js bound to a WebSocket session (see session.ts);
 * until the gateway backend ships they run against an in-browser preview shell, so the
 * whole surface is usable now.
 */
export default function CloudShellPage() {
  const { region } = useEmulator();
  const { notify } = useNotifications();
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState("");
  const [split, setSplit] = useState<SplitMode>("none");
  const [fullscreen, setFullscreen] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const handles = useRef<Record<string, XtermHandle | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  // Backend gateway is not deployed yet, so run the preview shell for now.
  const useSim = true;

  const makeTab = useCallback((): TabState => {
    counter.current += 1;
    return {
      id: `cs-${Date.now()}-${counter.current}`,
      // AWS titles each tab by the Region it runs in.
      title: region,
      state: "connecting",
    };
  }, [region]);

  // One session on mount; welcome dialog on first ever visit.
  useEffect(() => {
    const first = makeTab();
    setTabs([first]);
    setActiveId(first.id);
    if (localStorage.getItem(WELCOME_KEY) !== "true") {
      setWelcome(true);
    }
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
    setTabs((current) => {
      if (current.length === 1) {
        return current; // AWS keeps at least one session open.
      }
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeId) {
        setActiveId(next[next.length - 1].id);
      }
      return next;
    });
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

  const onUploadPicked = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // The preview shell has no filesystem; the real gateway pushes bytes into the session
    // container's ~/ directory.
    notify({
      type: "info",
      header: "Upload queued",
      content: `${files[0].name} will be uploaded to ~/ once the CloudShell backend is connected.`,
    });
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
        notify({ type: "info", content: "File download streams a container path in the real backend." });
        break;
      case "restart":
        handles.current[active?.id ?? ""]?.clear();
        notify({ type: "info", content: "Session restart is a no-op in the preview shell." });
        break;
      case "delete":
        if (active) closeTab(active.id);
        break;
      case "vpc-env":
        notify({
          type: "info",
          content: "VPC environments require the CloudShell backend and LCS VPC networking.",
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
                    { id: "download", text: "Download file" },
                    { id: "upload", text: "Upload file" },
                    { id: "restart", text: "Restart" },
                    { id: "delete", text: "Delete" },
                  ],
                },
                {
                  id: "global",
                  text: "Global actions",
                  items: [{ id: "vpc-env", text: "Create VPC environment (max 2)" }],
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
            <Button iconName="settings" variant="icon" ariaLabel="Settings" onClick={() => notify({ type: "info", content: "CloudShell settings arrive with the backend." })} />
          </SpaceBetween>
        }
      >
        CloudShell
      </Header>

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
            key={tab.id}
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
              ref={(handle) => { handles.current[tab.id] = handle; }}
              sessionId={tab.id}
              useSim={useSim}
              onState={(state, message) => setTabState(tab.id, state, message)}
            />
          </div>
        ))}
      </div>

      <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={(event) => onUploadPicked(event.target.files)} />

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
            uses the same credentials as the console.
          </Box>
          <ColumnLayout columns={3} variant="text-grid">
            <SpaceBetween size="xs">
              <Box variant="strong">Pre-installed tools</Box>
              <Box color="text-body-secondary">AWS CLI, Python, Node.js and more</Box>
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
