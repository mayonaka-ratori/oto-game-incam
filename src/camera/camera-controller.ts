import {
  createCameraConstraints,
  type TrackingExperimentProfile,
} from "../experiments/tracking-experiment-profile";

export interface CameraSession {
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;
  readonly settings: MediaTrackSettings;
  readonly capabilities: MediaTrackCapabilities | null;
}

export interface CameraTrackEvent {
  readonly type: "ended" | "mute" | "unmute";
  readonly track: MediaStreamTrack;
}

export class CameraController {
  #stream: MediaStream | null = null;
  #video: HTMLVideoElement | null = null;
  #requestToken = 0;
  readonly #onTrackEvent: (event: CameraTrackEvent) => void;

  constructor(onTrackEvent: (event: CameraTrackEvent) => void) {
    this.#onTrackEvent = onTrackEvent;
  }

  async start(
    video: HTMLVideoElement,
    profile: TrackingExperimentProfile,
  ): Promise<CameraSession> {
    const requestToken = ++this.#requestToken;
    this.#releaseStream();

    const stream = await requestPreferredCamera(profile);
    if (requestToken !== this.#requestToken) {
      stopStream(stream);
      throw new DOMException("A newer camera request replaced this one.", "AbortError");
    }

    const track = stream.getVideoTracks()[0];
    if (track === undefined) {
      stopStream(stream);
      throw new DOMException("The stream did not contain a video track.", "NotFoundError");
    }

    this.#stream = stream;
    this.#video = video;
    this.#attachTrackListeners(track);

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    try {
      await video.play();
    } catch (error) {
      if (requestToken === this.#requestToken) {
        this.#releaseStream();
      } else {
        stopStream(stream);
      }
      throw error;
    }

    if (requestToken !== this.#requestToken) {
      stopStream(stream);
      throw new DOMException("A newer camera request replaced this one.", "AbortError");
    }

    return {
      stream,
      track,
      settings: track.getSettings(),
      capabilities: typeof track.getCapabilities === "function" ? track.getCapabilities() : null,
    };
  }

  stop(): void {
    this.#requestToken += 1;
    this.#releaseStream();
  }

  #attachTrackListeners(track: MediaStreamTrack): void {
    for (const type of ["ended", "mute", "unmute"] as const) {
      track.addEventListener(type, () => {
        if (this.#stream?.getVideoTracks().includes(track) === true) {
          this.#onTrackEvent({ type, track });
        }
      });
    }
  }

  #releaseStream(): void {
    if (this.#video !== null) {
      this.#video.pause();
      this.#video.srcObject = null;
    }
    if (this.#stream !== null) {
      stopStream(this.#stream);
    }
    this.#video = null;
    this.#stream = null;
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function requestPreferredCamera(
  profile: TrackingExperimentProfile,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(createCameraConstraints(profile));
  } catch (error) {
    if (isConstraintError(error)) {
      return navigator.mediaDevices.getUserMedia(createCameraConstraints(profile, true));
    }
    throw error;
  }
}

function isConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }
  const name = Reflect.get(error, "name");
  return name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError";
}
