import "./ui/styles.css";
import { LabController } from "./app/lab-controller";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Application root was not found.");
}

/**
 * `?mode=speedcheck` opens the automatic speed check instead of the lab screen. It is loaded on
 * demand, so the normal screen downloads exactly what it downloaded before. Every other URL, and
 * a URL with no mode at all, keeps the lab screen.
 */
if (new URLSearchParams(window.location.search).get("mode") === "speedcheck") {
  const target = root;
  void import("./app/speed-check-controller")
    .then(({ SpeedCheckController }) => {
      new SpeedCheckController(target);
    })
    .catch((error: unknown) => {
      target.textContent = `速度チェックの画面を読み込めませんでした: ${String(error)}`;
    });
} else {
  new LabController(root);
}
