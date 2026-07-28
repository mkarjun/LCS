import type { BoardProps } from "@cloudscape-design/board-components/board";
import type { BoardItemProps } from "@cloudscape-design/board-components/board-item";

/**
 * Board accessibility strings.
 *
 * Cloudscape requires these — the drag-and-drop board is unusable with a keyboard or
 * screen reader without them, and the components throw if they are missing.
 */

const item: BoardItemProps.I18nStrings = {
  dragHandleAriaLabel: "Drag handle",
  dragHandleAriaDescription:
    "Use Space or Enter to activate drag, arrow keys to move, Space or Enter to submit, or Escape to discard.",
  resizeHandleAriaLabel: "Resize handle",
  resizeHandleAriaDescription:
    "Use Space or Enter to activate resize, arrow keys to resize, Space or Enter to submit, or Escape to discard.",
};

const board: BoardProps.I18nStrings<{ widgetId: string }> = {
  liveAnnouncementDndStarted: (operationType) =>
    operationType === "resize" ? "Resizing" : "Dragging",
  liveAnnouncementDndItemReordered: (operation) => {
    const columns = `column ${operation.placement.x + 1}`;
    const rows = `row ${operation.placement.y + 1}`;
    return `Item moved to ${operation.direction === "horizontal" ? columns : rows}.`;
  },
  liveAnnouncementDndItemResized: (operation) => {
    const columnsConstraint = operation.isMinimalColumnsReached ? " (minimal)" : "";
    const rowsConstraint = operation.isMinimalRowsReached ? " (minimal)" : "";
    const sizeAnnouncement =
      operation.direction === "horizontal"
        ? `columns ${operation.placement.width}${columnsConstraint}`
        : `rows ${operation.placement.height}${rowsConstraint}`;
    return `Item resized to ${sizeAnnouncement}.`;
  },
  liveAnnouncementDndItemInserted: (operation) => {
    const columns = `column ${operation.placement.x + 1}`;
    const rows = `row ${operation.placement.y + 1}`;
    return `Item inserted to ${columns}, ${rows}.`;
  },
  liveAnnouncementDndCommitted: (operationType) => `${operationType} committed`,
  liveAnnouncementDndDiscarded: (operationType) => `${operationType} discarded`,
  liveAnnouncementItemRemoved: (operation) => `Removed item ${operation.item.data.widgetId}.`,
  navigationAriaLabel: "Board navigation",
  navigationAriaDescription: "Click on non-empty item to move focus over",
  navigationItemAriaLabel: (item) => (item ? item.data.widgetId : "Empty"),
};

export const boardI18n = { board, item };
