import type {
  CreateLocalStorageToolsOptions,
  LocalStorageDeleteInput,
  LocalStorageEntry,
  LocalStorageReadInput,
  LocalStorageTool,
  LocalStorageToolDetails,
  LocalStorageWriteInput,
} from "../types/tools";

export type { CreateLocalStorageToolsOptions } from "../types/tools";

export function createLocalStorageTools(
  options: CreateLocalStorageToolsOptions = {},
): LocalStorageTool[] {
  const keyPrefix = options.keyPrefix ?? "";
  const resolveStorage = () => getStorage(options.storage);

  return [
    createReadTool(resolveStorage, keyPrefix),
    createCreateTool(resolveStorage, keyPrefix),
    createUpdateTool(resolveStorage, keyPrefix),
    createDeleteTool(resolveStorage, keyPrefix),
  ];
}

function createReadTool(
  resolveStorage: () => Storage,
  keyPrefix: string,
): LocalStorageTool {
  return {
    name: "local_storage_read",
    description:
      "Read data from browser localStorage. Provide a key to read a single item, or omit it to list all available scoped entries.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Optional key to read. Omit to list all available keys and values.",
        },
      },
      additionalProperties: false,
    },
    async execute({ input }) {
      const storage = resolveStorage();
      const readInput = input as LocalStorageReadInput;
      const totalEntries = listEntries(storage, keyPrefix);

      if (readInput.key === undefined) {
        return createToolResult(
          totalEntries.length === 0
            ? "No matching localStorage entries found."
            : [
                `Found ${totalEntries.length} localStorage entr${totalEntries.length === 1 ? "y" : "ies"}.`,
                ...totalEntries.map(
                  (entry) => `- ${entry.key} = ${JSON.stringify(entry.value)}`,
                ),
              ].join("\n"),
          {
            operation: "read",
            keyPrefix,
            entries: totalEntries,
            totalKeys: totalEntries.length,
          },
        );
      }

      const value = storage.getItem(createScopedKey(readInput.key, keyPrefix));
      const exists = value !== null;

      return createToolResult(
        exists
          ? [
              `Key "${readInput.key}" exists.`,
              `Value:\n${formatValue(value)}`,
            ].join("\n\n")
          : `Key "${readInput.key}" was not found.`,
        {
          operation: "read",
          key: readInput.key,
          keyPrefix,
          exists,
          value,
          totalKeys: totalEntries.length,
        },
      );
    },
  };
}

function createCreateTool(
  resolveStorage: () => Storage,
  keyPrefix: string,
): LocalStorageTool {
  return {
    name: "local_storage_create",
    description:
      "Create a new browser localStorage entry. This tool fails if the key already exists, so use it only for new data.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key to create.",
        },
        value: {
          type: "string",
          description: "String value to store.",
        },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
    async execute({ input }) {
      const storage = resolveStorage();
      const createInput = input as LocalStorageWriteInput;
      const scopedKey = createScopedKey(createInput.key, keyPrefix);

      if (storage.getItem(scopedKey) !== null) {
        throw new Error(`Key "${createInput.key}" already exists.`);
      }

      storage.setItem(scopedKey, createInput.value);
      const totalKeys = listEntries(storage, keyPrefix).length;

      return createToolResult(
        [
          `Created key "${createInput.key}".`,
          `Value:\n${formatValue(createInput.value)}`,
        ].join("\n\n"),
        {
          operation: "create",
          key: createInput.key,
          value: createInput.value,
          keyPrefix,
          totalKeys,
        },
      );
    },
  };
}

function createUpdateTool(
  resolveStorage: () => Storage,
  keyPrefix: string,
): LocalStorageTool {
  return {
    name: "local_storage_update",
    description:
      "Update an existing browser localStorage entry. This tool fails if the key does not exist yet.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key to update.",
        },
        value: {
          type: "string",
          description: "Replacement string value.",
        },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
    async execute({ input }) {
      const storage = resolveStorage();
      const updateInput = input as LocalStorageWriteInput;
      const scopedKey = createScopedKey(updateInput.key, keyPrefix);

      if (storage.getItem(scopedKey) === null) {
        throw new Error(`Key "${updateInput.key}" does not exist.`);
      }

      storage.setItem(scopedKey, updateInput.value);
      const totalKeys = listEntries(storage, keyPrefix).length;

      return createToolResult(
        [
          `Updated key "${updateInput.key}".`,
          `Value:\n${formatValue(updateInput.value)}`,
        ].join("\n\n"),
        {
          operation: "update",
          key: updateInput.key,
          value: updateInput.value,
          keyPrefix,
          totalKeys,
        },
      );
    },
  };
}

function createDeleteTool(
  resolveStorage: () => Storage,
  keyPrefix: string,
): LocalStorageTool {
  return {
    name: "local_storage_delete",
    description: "Delete a browser localStorage entry by key.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key to delete.",
        },
      },
      required: ["key"],
      additionalProperties: false,
    },
    async execute({ input }) {
      const storage = resolveStorage();
      const deleteInput = input as LocalStorageDeleteInput;
      const scopedKey = createScopedKey(deleteInput.key, keyPrefix);
      const existed = storage.getItem(scopedKey) !== null;

      if (existed) {
        storage.removeItem(scopedKey);
      }

      const totalKeys = listEntries(storage, keyPrefix).length;

      return createToolResult(
        existed
          ? `Deleted key "${deleteInput.key}".`
          : `Key "${deleteInput.key}" did not exist. Nothing was deleted.`,
        {
          operation: "delete",
          key: deleteInput.key,
          existed,
          keyPrefix,
          totalKeys,
        },
      );
    },
  };
}

function createToolResult(text: string, details: LocalStorageToolDetails) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    details,
  };
}

function getStorage(storage?: Storage) {
  if (storage) {
    return storage;
  }

  try {
    if (globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Some browser contexts throw when localStorage access is blocked.
  }

  throw new Error("localStorage is not available in the current environment");
}

function createScopedKey(key: string, keyPrefix: string) {
  return `${keyPrefix}${key}`;
}

function formatValue(value: string | null) {
  if (value === null) {
    return "(null)";
  }

  return value === "" ? "(empty string)" : value;
}

function listEntries(storage: Storage, keyPrefix: string): LocalStorageEntry[] {
  const entries: LocalStorageEntry[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const storedKey = storage.key(index);
    if (storedKey === null || !storedKey.startsWith(keyPrefix)) {
      continue;
    }

    const value = storage.getItem(storedKey);
    if (value === null) {
      continue;
    }

    entries.push({
      key: storedKey.slice(keyPrefix.length),
      value,
    });
  }

  return entries.sort((left, right) => left.key.localeCompare(right.key));
}
