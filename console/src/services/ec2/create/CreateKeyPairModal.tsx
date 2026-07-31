import { useEffect, useState } from "react";
import { CreateKeyPairCommand } from "@aws-sdk/client-ec2";
import Alert from "@cloudscape-design/components/alert";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "../useEc2Client";
import { CreateModalShell } from "./CreateModalShell";
import { tagSpecifications, useCreateForm } from "./createForm";
import type { Ec2CreateModalProps } from "./createForm";

/**
 * AWS's key-pair name rule: up to 255 ASCII characters, and it may not contain a leading
 * or trailing space.
 */
function validateKeyName(name: string): string | null {
  if (name === "") {
    return "Key pair name is required.";
  }
  if (name.length > 255) {
    return "Key pair name can be up to 255 characters.";
  }
  return null;
}

/**
 * Hands the private key to the browser's download manager, which is the only chance to
 * save it — CreateKeyPair returns the material once and AWS never shows it again.
 */
function downloadPrivateKey(fileName: string, material: string) {
  const url = URL.createObjectURL(new Blob([material], { type: "application/x-pem-file" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function CreateKeyPairModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [name, setName] = useState("");
  const [keyType, setKeyType] = useState("rsa");
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  useEffect(() => {
    if (visible) {
      setName("");
      setKeyType("rsa");
      setTags([]);
      setFormError(null);
    }
  }, [visible, setFormError]);

  const onSubmit = () => {
    const message = validateKeyName(name.trim());
    if (message !== null) {
      setFormError(message);
      return;
    }
    void submit(async () => {
      const response = await client.send(
        new CreateKeyPairCommand({
          KeyName: name.trim(),
          KeyType: keyType as "rsa" | "ed25519",
          TagSpecifications: tagSpecifications("key-pair", "", tags),
        }),
      );
      if (response.KeyMaterial) {
        downloadPrivateKey(`${name.trim()}.pem`, response.KeyMaterial);
      }
      notify({
        type: "success",
        header: `Key pair "${name.trim()}" created`,
        content: response.KeyMaterial
          ? "The private key has been downloaded. Store it somewhere safe — it cannot be retrieved again."
          : "The emulator returned no private key material for this key pair.",
      });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create key pair"
      submitLabel="Create key pair"
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
    >
      <FormField
        label="Name"
        description="Key pairs allow you to connect to your instance securely."
        constraintText="Up to 255 ASCII characters."
      >
        <Input
          value={name}
          autoFocus
          placeholder="my-key-pair"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField label="Key pair type">
        <RadioGroup
          value={keyType}
          onChange={(event) => setKeyType(event.detail.value)}
          items={[
            { value: "rsa", label: "RSA", description: "RSA encrypted private and public key pair." },
            {
              value: "ed25519",
              label: "ED25519",
              description: "ED25519 encrypted private and public key pair.",
            },
          ]}
        />
      </FormField>
      <FormField
        label="Private key file format"
        description="LCS returns OpenSSH-format material only, so .ppk (PuTTY) is not offered — AWS converts the key server-side and the emulator does not."
      >
        <RadioGroup
          value="pem"
          onChange={() => undefined}
          items={[
            { value: "pem", label: ".pem", description: "For use with OpenSSH." },
            { value: "ppk", label: ".ppk", description: "For use with PuTTY.", disabled: true },
          ]}
        />
      </FormField>
      <FormField label="Tags" description="A tag is a label you assign to an AWS resource.">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this key pair."
        />
      </FormField>
      <Alert type="info" header="The private key is downloaded once">
        Amazon EC2 returns the private key only when the key pair is created. Keep the
        downloaded file — there is no way to fetch it again.
      </Alert>
    </CreateModalShell>
  );
}
