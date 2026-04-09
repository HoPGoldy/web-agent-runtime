import type { SessionDataCodec } from "./contracts";
import {
  cloneRuntimeSessionData,
  isRuntimeSessionData,
  RUNTIME_SESSION_DATA_VERSION,
  type RuntimeSessionData,
} from "./session-types";

export const SESSION_DATA_VERSION = RUNTIME_SESSION_DATA_VERSION;

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
