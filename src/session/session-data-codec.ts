import type { RuntimeSessionData, SessionDataCodec } from "../types/session";
import {
  cloneRuntimeSessionData,
  isRuntimeSessionData,
  RUNTIME_SESSION_DATA_VERSION,
} from "./runtime-session-data";

/**
 * Current persisted runtime session data version understood by the default JSON codec.
 */
export const SESSION_DATA_VERSION = RUNTIME_SESSION_DATA_VERSION;

/**
 * Creates the default pass-through codec for JSON-serializable runtime session data.
 */
export function createJsonSessionDataCodec(): SessionDataCodec<RuntimeSessionData, RuntimeSessionData> {
  return {
    async serialize(data) {
      return cloneRuntimeSessionData(assertRuntimeSessionData(data));
    },
    async deserialize(data) {
      return cloneRuntimeSessionData(assertRuntimeSessionData(data));
    },
  };
}

function assertRuntimeSessionData(data: unknown): RuntimeSessionData {
  if (!isRuntimeSessionData(data)) {
    throw new Error("Invalid runtime session data");
  }

  if (data.version !== SESSION_DATA_VERSION) {
    throw new Error(`Unsupported runtime session data version: ${data.version}`);
  }

  return data;
}
