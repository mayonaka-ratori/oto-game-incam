import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRAME_PIPELINE_OPTIONS,
  resolveFramePipelineOptions,
} from "../src/camera/frame-pipeline-options";

// The tester changes one of these in the URL and saves another 20-trial run. The defaults must
// stay exactly what the app did before, so an unchanged URL keeps producing comparable sessions.

describe("frame pipeline options from the query string", () => {
  it("keeps the long-standing behaviour when nothing is given", () => {
    expect(DEFAULT_FRAME_PIPELINE_OPTIONS).toEqual({ frameSourceOverride: "auto", pendingPolicy: "hold" });
    for (const search of ["", "?", "?view=analysis", "?frameSource=", "?frameSource=vulkan&pending=maybe"]) {
      expect(resolveFramePipelineOptions(search), search).toEqual(DEFAULT_FRAME_PIPELINE_OPTIONS);
    }
  });

  it("reads each override on its own and both together", () => {
    expect(resolveFramePipelineOptions("?frameSource=rvfc")).toEqual({
      frameSourceOverride: "rvfc",
      pendingPolicy: "hold",
    });
    expect(resolveFramePipelineOptions("?frameSource=timer")).toEqual({
      frameSourceOverride: "timer",
      pendingPolicy: "hold",
    });
    expect(resolveFramePipelineOptions("?pending=drop")).toEqual({
      frameSourceOverride: "auto",
      pendingPolicy: "drop",
    });
    expect(resolveFramePipelineOptions("?protocol=five&frameSource=RVFC&pending=Drop")).toEqual({
      frameSourceOverride: "rvfc",
      pendingPolicy: "drop",
    });
  });
});
