import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { FlashbarProps } from "@cloudscape-design/components/flashbar";

type NotifyInput = Omit<FlashbarProps.MessageDefinition, "id" | "onDismiss">;

interface NotificationContextValue {
  items: FlashbarProps.MessageDefinition[];
  notify: (message: NotifyInput) => void;
  clear: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

let nextId = 0;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<FlashbarProps.MessageDefinition[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (message: NotifyInput) => {
      const id = `flash-${(nextId += 1)}`;
      setItems((current) => [
        ...current,
        { ...message, id, dismissible: true, onDismiss: () => dismiss(id) },
      ]);
    },
    [dismiss],
  );

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({ items, notify, clear }), [items, notify, clear]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (value === null) {
    throw new Error("useNotifications must be used inside a NotificationProvider");
  }
  return value;
}
