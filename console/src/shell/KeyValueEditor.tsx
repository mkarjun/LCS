import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Input from "@cloudscape-design/components/input";

export interface KeyValuePair {
  key: string;
  value: string;
}

/**
 * Key/value rows, used wherever AWS asks for tags or a free-form name/value list.
 *
 * For CloudFormation stack parameters the AWS console reads the template's Parameters
 * section and renders a typed field per parameter. Doing that would mean parsing
 * CloudFormation YAML — including its short-form intrinsics — in the browser, so callers
 * ask for the pairs directly instead and the service reports any name it does not know.
 */
export function KeyValueEditor({
  items,
  onChange,
  keyLabel,
  valueLabel,
  addLabel,
  empty,
}: {
  items: KeyValuePair[];
  onChange: (items: KeyValuePair[]) => void;
  keyLabel: string;
  valueLabel: string;
  addLabel: string;
  empty: string;
}) {
  const update = (index: number, patch: Partial<KeyValuePair>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <AttributeEditor
      items={items}
      addButtonText={addLabel}
      removeButtonText="Remove"
      empty={empty}
      onAddButtonClick={() => onChange([...items, { key: "", value: "" }])}
      onRemoveButtonClick={(event) =>
        onChange(items.filter((_, index) => index !== event.detail.itemIndex))
      }
      definition={[
        {
          label: keyLabel,
          control: (item: KeyValuePair, index) => (
            <Input
              value={item.key}
              placeholder={keyLabel}
              onChange={(event) => update(index, { key: event.detail.value })}
            />
          ),
        },
        {
          label: valueLabel,
          control: (item: KeyValuePair, index) => (
            <Input
              value={item.value}
              placeholder={valueLabel}
              onChange={(event) => update(index, { value: event.detail.value })}
            />
          ),
        },
      ]}
    />
  );
}
