import type { PendingFramePolicy } from "./latest-frame-scheduler";
import type { FrameSourceOverride } from "./create-frame-source";

/**
 * How the camera frames reach the tracking Worker. Both values come from the query string so that
 * one device can be measured again with exactly one change between the runs, and both are written
 * into the result JSON so a later reader knows what was measured (docs/18 の5.4).
 */
export interface FramePipelineOptions {
  readonly frameSourceOverride: FrameSourceOverride;
  readonly pendingPolicy: PendingFramePolicy;
}

export const DEFAULT_FRAME_PIPELINE_OPTIONS: FramePipelineOptions = {
  frameSourceOverride: "auto",
  pendingPolicy: "hold",
};

/** `?frameSource=rvfc|timer|auto` and `?pending=drop|hold`. Anything else keeps the default. */
export function resolveFramePipelineOptions(search: string): FramePipelineOptions {
  const parameters = new URLSearchParams(search);
  return {
    frameSourceOverride: frameSourceOverride(parameters.get("frameSource")),
    pendingPolicy: pendingFramePolicy(parameters.get("pending")),
  };
}

function frameSourceOverride(value: string | null): FrameSourceOverride {
  const normalized = value === null ? "" : value.trim().toLowerCase();
  if (normalized === "rvfc" || normalized === "timer" || normalized === "auto") return normalized;
  return DEFAULT_FRAME_PIPELINE_OPTIONS.frameSourceOverride;
}

function pendingFramePolicy(value: string | null): PendingFramePolicy {
  const normalized = value === null ? "" : value.trim().toLowerCase();
  if (normalized === "drop" || normalized === "hold") return normalized;
  return DEFAULT_FRAME_PIPELINE_OPTIONS.pendingPolicy;
}
