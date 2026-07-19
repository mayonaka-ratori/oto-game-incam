import { describe, expect, it } from "vitest";
import { initialLabState, transitionLabState } from "../src/app/lab-state";

describe("transitionLabState", () => {
  it("moves from support check to permission guidance", () => {
    const state = transitionLabState(initialLabState, { type: "SUPPORT_OK" });
    expect(state.kind).toBe("permission-required");
    expect(state.message).toContain("保存しません");
  });

  it("keeps every blocking issue visible", () => {
    const state = transitionLabState(initialLabState, {
      type: "SUPPORT_FAILED",
      issues: [
        { code: "insecure-context", message: "HTTPSが必要です。" },
        { code: "media-devices", message: "APIがありません。" },
      ],
    });
    expect(state.kind).toBe("unsupported");
    expect(state.message).toContain("HTTPSが必要です。");
    expect(state.message).toContain("APIがありません。");
  });

  it("separates permission denial from a generic error", () => {
    const denied = transitionLabState(initialLabState, {
      type: "CAMERA_FAILED",
      error: {
        code: "permission-denied",
        title: "denied",
        guidance: "retry",
        technicalName: "NotAllowedError",
      },
    });
    const busy = transitionLabState(initialLabState, {
      type: "CAMERA_FAILED",
      error: {
        code: "device-busy",
        title: "busy",
        guidance: "close app",
        technicalName: "NotReadableError",
      },
    });

    expect(denied.kind).toBe("permission-denied");
    expect(busy.kind).toBe("error");
  });

  it("does not label an interrupted camera as a player miss", () => {
    const state = transitionLabState(initialLabState, {
      type: "CAMERA_INTERRUPTED",
      technicalDetail: "MediaStreamTrack ended",
    });
    expect(state.kind).toBe("interrupted");
    expect(state.title).not.toContain("MISS");
  });
});

