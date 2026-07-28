import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import type { InputProps } from "@cloudscape-design/components/input";

import { SERVICE_CATALOG, servicePath } from "@services/catalog";

/**
 * Global service search, mirroring the AWS console's search box.
 *
 * AWS binds this to Alt+S, so the same shortcut is wired here — muscle memory is part of
 * the parity goal.
 */
export function ServiceSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const inputRef = useRef<InputProps.Ref>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const options = useMemo(
    () =>
      SERVICE_CATALOG.map((entry) => ({
        value: servicePath(entry),
        label: entry.name,
        description: entry.description,
        // Lets "sqs", "queue", or "Amazon SQS" all find the same service.
        tags: [entry.shortName, entry.id, entry.category],
      })),
    [],
  );

  return (
    <Autosuggest
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.detail.value)}
      onSelect={(event) => {
        const selected = options.find((option) => option.value === event.detail.value);
        if (selected) {
          setValue("");
          navigate(`/${selected.value}`);
        }
      }}
      options={options}
      enteredTextLabel={(entered) => `Search for "${entered}"`}
      placeholder="Search services  [Alt+S]"
      ariaLabel="Search services"
      empty="No services found"
      filteringType="auto"
    />
  );
}
