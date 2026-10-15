import { invoke } from "@tauri-apps/api/core";
import type { AppError } from "./types";

export class IpcError extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = "IpcError";
    this.error = error;
  }
}

export function isIpcError(e: unknown): e is IpcError {
  return e instanceof IpcError;
}

function isAppError(v: unknown): v is AppError {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { code?: unknown }).code === "string" &&
    typeof (v as { message?: unknown }).message === "string"
  );
}

function normalize(err: unknown): AppError {
  if (isAppError(err)) return err;
  return { code: "ipc.unknown", message: String(err) };
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new IpcError(normalize(err));
  }
}
