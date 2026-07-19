import type { ClassifiedCameraError } from "../camera/camera-errors";
import type { SupportIssue } from "../camera/camera-support";

export type LabStateKind =
  | "checking"
  | "unsupported"
  | "permission-required"
  | "requesting"
  | "active"
  | "permission-denied"
  | "no-device"
  | "interrupted"
  | "error";

export interface LabState {
  readonly kind: LabStateKind;
  readonly title: string;
  readonly message: string;
  readonly technicalDetail: string;
}

export type LabEvent =
  | { readonly type: "SUPPORT_OK" }
  | { readonly type: "SUPPORT_FAILED"; readonly issues: readonly SupportIssue[] }
  | { readonly type: "REQUEST_CAMERA" }
  | { readonly type: "CAMERA_STARTED" }
  | { readonly type: "CAMERA_STOPPED" }
  | { readonly type: "CAMERA_INTERRUPTED"; readonly technicalDetail: string }
  | { readonly type: "CAMERA_FAILED"; readonly error: ClassifiedCameraError };

export const initialLabState: LabState = {
  kind: "checking",
  title: "対応環境を確認しています",
  message: "カメラAPIと接続状態を確認しています。",
  technicalDetail: "",
};

export function transitionLabState(_current: LabState, event: LabEvent): LabState {
  switch (event.type) {
    case "SUPPORT_OK":
      return {
        kind: "permission-required",
        title: "カメラを準備します",
        message: "映像はこの端末内のプレビューだけに使い、送信・保存しません。",
        technicalDetail: "",
      };
    case "SUPPORT_FAILED":
      return {
        kind: "unsupported",
        title: "この環境ではカメラを開始できません",
        message: event.issues.map((issue) => issue.message).join(" "),
        technicalDetail: event.issues.map((issue) => issue.code).join(", "),
      };
    case "REQUEST_CAMERA":
      return {
        kind: "requesting",
        title: "カメラの許可を待っています",
        message: "ブラウザの確認画面でカメラの使用を許可してください。",
        technicalDetail: "",
      };
    case "CAMERA_STARTED":
      return {
        kind: "active",
        title: "カメラ計測中",
        message: "インカメの実設定とフレーム間隔を計測しています。",
        technicalDetail: "",
      };
    case "CAMERA_STOPPED":
      return {
        kind: "permission-required",
        title: "カメラを停止しました",
        message: "必要になったら、もう一度カメラを開始できます。",
        technicalDetail: "",
      };
    case "CAMERA_INTERRUPTED":
      return {
        kind: "interrupted",
        title: "カメラが途中で停止しました",
        message: "ほかのアプリや端末の状態を確認して再試行してください。",
        technicalDetail: event.technicalDetail,
      };
    case "CAMERA_FAILED": {
      const kind =
        event.error.code === "permission-denied"
          ? "permission-denied"
          : event.error.code === "no-device"
            ? "no-device"
            : "error";
      return {
        kind,
        title: event.error.title,
        message: event.error.guidance,
        technicalDetail: event.error.technicalName,
      };
    }
  }
}
