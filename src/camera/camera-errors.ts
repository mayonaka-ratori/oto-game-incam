export type CameraErrorCode =
  | "permission-denied"
  | "no-device"
  | "device-busy"
  | "constraints"
  | "aborted"
  | "unknown";

export interface ClassifiedCameraError {
  readonly code: CameraErrorCode;
  readonly title: string;
  readonly guidance: string;
  readonly technicalName: string;
}

function getErrorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = Reflect.get(error, "name");
    return typeof name === "string" ? name : "UnknownError";
  }
  return "UnknownError";
}

export function classifyCameraError(error: unknown): ClassifiedCameraError {
  const technicalName = getErrorName(error);

  switch (technicalName) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        code: "permission-denied",
        title: "カメラを開始できませんでした",
        guidance: "ブラウザまたは端末の設定でカメラを許可してから再試行してください。",
        technicalName,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        code: "no-device",
        title: "利用できるカメラが見つかりません",
        guidance: "カメラの接続と、ほかのアプリから利用可能な状態かを確認してください。",
        technicalName,
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        code: "device-busy",
        title: "カメラを使用できません",
        guidance: "ほかのアプリのカメラ利用を終了し、少し待ってから再試行してください。",
        technicalName,
      };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return {
        code: "constraints",
        title: "要求したカメラ条件を利用できません",
        guidance: "端末のカメラ設定を確認して再試行してください。",
        technicalName,
      };
    case "AbortError":
      return {
        code: "aborted",
        title: "カメラの開始が中断されました",
        guidance: "端末の状態を確認して再試行してください。",
        technicalName,
      };
    default:
      return {
        code: "unknown",
        title: "カメラを開始できませんでした",
        guidance: "ページを再読み込みするか、ブラウザを再起動して試してください。",
        technicalName,
      };
  }
}

