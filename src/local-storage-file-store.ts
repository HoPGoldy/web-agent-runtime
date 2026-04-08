export interface LocalStorageFileStore {
  getFiles(): Record<string, string>;
  reset(): Record<string, string>;
  subscribe(listener: (files: Record<string, string>) => void): () => void;
  read(key: string): { key: string; exists: boolean; content?: string };
  write(
    key: string,
    content: string,
  ): { key: string; written: true; size: number };
  edit(
    key: string,
    oldText: string,
    newText: string,
  ): { key: string; edited: true };
}

interface CreateLocalStorageFileStoreOptions {
  storageKey: string;
  initialFiles: Record<string, string>;
}

function cloneFiles(files: Record<string, string>) {
  return JSON.parse(JSON.stringify(files)) as Record<string, string>;
}

export function createLocalStorageFileStore(
  options: CreateLocalStorageFileStoreOptions,
): LocalStorageFileStore {
  const listeners = new Set<(files: Record<string, string>) => void>();

  const save = (files: Record<string, string>) => {
    localStorage.setItem(options.storageKey, JSON.stringify(files));
    const snapshot = cloneFiles(files);
    for (const listener of Array.from(listeners)) {
      listener(snapshot);
    }
  };

  const load = () => {
    const raw = localStorage.getItem(options.storageKey);
    if (!raw) {
      const files = cloneFiles(options.initialFiles);
      save(files);
      return files;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid local storage file payload");
      }
      return cloneFiles(parsed);
    } catch {
      const files = cloneFiles(options.initialFiles);
      save(files);
      return files;
    }
  };

  return {
    getFiles() {
      return load();
    },
    reset() {
      const files = cloneFiles(options.initialFiles);
      save(files);
      return files;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read(key) {
      const files = load();
      if (!(key in files)) {
        return { key, exists: false };
      }

      return {
        key,
        exists: true,
        content: files[key],
      };
    },
    write(key, content) {
      const files = load();
      const nextFiles = {
        ...files,
        [key]: content,
      };
      save(nextFiles);
      return {
        key,
        written: true,
        size: content.length,
      };
    },
    edit(key, oldText, newText) {
      const files = load();
      const current = files[key];
      if (current == null) {
        throw new Error(`File not found: ${key}`);
      }

      const matches = current.split(oldText).length - 1;
      if (matches === 0) {
        throw new Error(`Text not found in ${key}`);
      }
      if (matches > 1) {
        throw new Error(`Text matched more than once in ${key}`);
      }

      const nextFiles = {
        ...files,
        [key]: current.replace(oldText, newText),
      };
      save(nextFiles);
      return {
        key,
        edited: true,
      };
    },
  };
}
