import { useCallback, useEffect, useState } from "react";
import Board from "@cloudscape-design/board-components/board";
import BoardItem from "@cloudscape-design/board-components/board-item";
import type { BoardProps } from "@cloudscape-design/board-components/board";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { useEmulator } from "@platform/EmulatorContext";
import { useBreadcrumbs } from "./BreadcrumbContext";
import { DEFAULT_WIDGET_IDS, WIDGET_DEFINITIONS, findWidget } from "./widgets/definitions";
import { boardI18n } from "./widgets/boardI18n";

const LAYOUT_STORAGE_KEY = "lcs-console-home-layout";

/** Board items carry only the widget id; content is looked up from the definitions. */
type HomeItem = BoardProps.Item<{ widgetId: string }>;

function itemFromWidgetId(widgetId: string): HomeItem | null {
  const widget = findWidget(widgetId);
  if (widget === null || widget === undefined) {
    return null;
  }
  return {
    id: widget.id,
    rowSpan: widget.defaultRowSpan,
    columnSpan: widget.defaultColumnSpan,
    data: { widgetId: widget.id },
  };
}

function defaultItems(): HomeItem[] {
  return DEFAULT_WIDGET_IDS.map(itemFromWidgetId).filter((item): item is HomeItem => item !== null);
}

function readStoredLayout(): HomeItem[] | null {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    // Drop any widget ids that no longer exist, so a stored layout never breaks the page
    // after widgets are renamed or removed.
    const items = parsed
      .filter((item): item is HomeItem => typeof item === "object" && item !== null && "id" in item)
      .filter((item) => findWidget(item.id) !== undefined);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

export function HomePage() {
  const { error } = useEmulator();
  const [items, setItems] = useState<HomeItem[]>(() => readStoredLayout() ?? defaultItems());
  const [paletteOpen, setPaletteOpen] = useState(false);

  useBreadcrumbs([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Layout persistence is a convenience; ignore storage failures.
    }
  }, [items]);

  const removeItem = useCallback((itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  const resetLayout = useCallback(() => {
    setItems(defaultItems());
  }, []);

  const availableWidgets = WIDGET_DEFINITIONS.filter(
    (widget) => !items.some((item) => item.id === widget.id),
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="A local AWS-compatible cloud. Point any AWS SDK, CLI, or IaC tool at this endpoint."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={resetLayout}>Reset to default layout</Button>
              <Button
                variant="primary"
                iconName="add-plus"
                disabled={availableWidgets.length === 0}
                onClick={() => setPaletteOpen(true)}
              >
                Add widgets
              </Button>
            </SpaceBetween>
          }
        >
          Console home
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error && (
          <Alert type="warning" header="Service catalog unavailable">
            Couldn't read the emulator's service list, so running/disabled status is hidden.
            Service consoles still work. ({error.message})
          </Alert>
        )}

        <Board<{ widgetId: string }>
          items={items}
          renderItem={(item) => {
            const widget = findWidget(item.data.widgetId);
            if (widget === undefined) {
              return <BoardItem i18nStrings={boardI18n.item} header={<Header>Unknown widget</Header>} />;
            }
            return (
              <BoardItem
                i18nStrings={boardI18n.item}
                header={<Header variant="h2">{widget.title}</Header>}
                settings={
                  <ButtonDropdown
                    items={[{ id: "remove", text: "Remove" }]}
                    ariaLabel={`${widget.title} settings`}
                    variant="icon"
                    onItemClick={(event) => {
                      if (event.detail.id === "remove") {
                        removeItem(item.id);
                      }
                    }}
                  />
                }
              >
                {widget.content}
              </BoardItem>
            );
          }}
          onItemsChange={(event) => setItems(event.detail.items as HomeItem[])}
          i18nStrings={boardI18n.board}
          empty={
            <Box textAlign="center" padding={{ vertical: "xxl" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No widgets</Box>
                <Box variant="p" color="text-body-secondary">
                  Add widgets to build your console home.
                </Box>
                <Button onClick={resetLayout}>Reset to default layout</Button>
              </SpaceBetween>
            </Box>
          }
        />
      </SpaceBetween>

      <Modal
        visible={paletteOpen}
        onDismiss={() => setPaletteOpen(false)}
        header="Add widgets"
        size="medium"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => setPaletteOpen(false)}>
              Done
            </Button>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box variant="p" color="text-body-secondary">
            Add a widget to the board. Once added, drag it by its handle to rearrange, or
            resize it from its lower-right corner.
          </Box>
          {availableWidgets.length === 0 ? (
            <Box color="text-body-secondary">All available widgets are already on the board.</Box>
          ) : (
            <SpaceBetween size="s">
              {availableWidgets.map((widget) => (
                <Box key={widget.id}>
                  <SpaceBetween size="xxs">
                    <SpaceBetween size="xs" direction="horizontal">
                      <Box variant="strong">{widget.title}</Box>
                      <Button
                        variant="inline-link"
                        onClick={() => {
                          const item = itemFromWidgetId(widget.id);
                          if (item !== null) {
                            setItems((current) => [...current, item]);
                          }
                        }}
                      >
                        Add
                      </Button>
                    </SpaceBetween>
                    <Box variant="small" color="text-body-secondary">
                      {widget.description}
                    </Box>
                  </SpaceBetween>
                </Box>
              ))}
            </SpaceBetween>
          )}
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  );
}
