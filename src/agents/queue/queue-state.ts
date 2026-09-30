import { randomUUID } from "node:crypto";
import type { StoredLoopSender, StoredLoopSurfaceBinding } from "../loops/loop-state.ts";

export type StoredQueueSender = StoredLoopSender;
export type StoredQueueSurfaceBinding = StoredLoopSurfaceBinding;
export type StoredQueueStatus = "pending" | "running";

export type StoredQueueItem = {
  id: string;
  status: StoredQueueStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  promptText: string;
  protectedControlMutationRule?: string;
  promptSummary: string;
  promptSource: "custom";
  createdBy?: string;
  // Where the item came from. "cli" (clisbot queues create) and "loop" items are automation: when the
  // agent finishes without a message-tool reply, their pane is NOT posted to the chat as a fallback
  // (bobbymarko fork, 2026-09-30: quiet background jobs were each ending in a pane dump to Bobby).
  // Missing = created before this field existed; treated like "chat" (the old behaviour).
  origin?: "cli" | "loop" | "chat";
  sender?: StoredQueueSender;
  surfaceBinding?: StoredQueueSurfaceBinding;
};

export type QueuedPromptStatus = StoredQueueItem & {
  agentId: string;
  sessionKey: string;
  positionAhead: number;
};

function createQueueId() {
  return randomUUID().split("-")[0] ?? randomUUID();
}

export function summarizeQueuePrompt(text: string) {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 80) {
    return singleLine || "(empty prompt)";
  }
  return `${singleLine.slice(0, 77)}...`;
}

export function createStoredQueueItem(params: {
  promptText: string;
  protectedControlMutationRule?: string;
  promptSummary?: string;
  createdBy?: string;
  origin?: "cli" | "loop" | "chat";
  sender?: StoredQueueSender;
  surfaceBinding?: StoredQueueSurfaceBinding;
}): StoredQueueItem {
  const now = Date.now();
  return {
    id: createQueueId(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    promptText: params.promptText,
    protectedControlMutationRule: params.protectedControlMutationRule,
    promptSummary: params.promptSummary ?? summarizeQueuePrompt(params.promptText),
    promptSource: "custom",
    createdBy: params.createdBy,
    ...(params.origin ? { origin: params.origin } : {}),
    sender: params.sender,
    surfaceBinding: params.surfaceBinding,
  };
}
