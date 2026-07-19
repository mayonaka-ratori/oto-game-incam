export interface CameraSupportSnapshot {
  readonly secureContext: boolean;
  readonly mediaDevices: boolean;
  readonly getUserMedia: boolean;
  readonly requestVideoFrameCallback: boolean;
  readonly mediaStreamTrackProcessor: boolean;
  readonly videoFrame: boolean;
  readonly imageBitmap: boolean;
}

export interface SupportIssue {
  readonly code: "insecure-context" | "media-devices" | "get-user-media";
  readonly message: string;
}

export function inspectCameraSupport(): CameraSupportSnapshot {
  const videoPrototype = globalThis.HTMLVideoElement?.prototype;
  const mediaDevices = typeof navigator.mediaDevices !== "undefined";

  return {
    secureContext: window.isSecureContext,
    mediaDevices,
    getUserMedia: mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function",
    requestVideoFrameCallback:
      videoPrototype !== undefined &&
      typeof videoPrototype.requestVideoFrameCallback === "function",
    mediaStreamTrackProcessor: "MediaStreamTrackProcessor" in globalThis,
    videoFrame: "VideoFrame" in globalThis,
    imageBitmap: "createImageBitmap" in globalThis,
  };
}

export function getBlockingSupportIssues(
  support: CameraSupportSnapshot,
): readonly SupportIssue[] {
  const issues: SupportIssue[] = [];

  if (!support.secureContext) {
    issues.push({
      code: "insecure-context",
      message: "カメラにはlocalhostまたは有効なHTTPS接続が必要です。",
    });
  }
  if (!support.mediaDevices) {
    issues.push({
      code: "media-devices",
      message: "このブラウザではMedia Devices APIを利用できません。",
    });
  } else if (!support.getUserMedia) {
    issues.push({
      code: "get-user-media",
      message: "このブラウザではカメラ取得APIを利用できません。",
    });
  }

  return issues;
}

