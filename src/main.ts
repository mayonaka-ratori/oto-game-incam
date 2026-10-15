import "./ui/styles.css";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Application root was not found.");
}

// Camera-free practice never loads the camera controller or the tracking implementation.
const mode = new URLSearchParams(window.location.search).get("mode");
if (mode === "practice") {
  const target = root;
  void import("./practice/practice-controller")
    .then(({ PracticeController }) => {
      new PracticeController(target);
    })
    .catch((error: unknown) => {
      target.textContent = `練習の画面を読み込めませんでした: ${String(error)}`;
    });
} else if (mode === "speedcheck") {
  const target = root;
  void import("./app/speed-check-controller")
    .then(({ SpeedCheckController }) => {
      new SpeedCheckController(target);
    })
    .catch((error: unknown) => {
      target.textContent = `速度チェックの画面を読み込めませんでした: ${String(error)}`;
    });
} else {
  const target = root;
  void import("./app/lab-controller")
    .then(({ LabController }) => {
      new LabController(target);
    })
    .catch((error: unknown) => {
      target.textContent = `計測画面を読み込めませんでした: ${String(error)}`;
    });
}
