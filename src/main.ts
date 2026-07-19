import "./ui/styles.css";
import { LabController } from "./app/lab-controller";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Application root was not found.");
}

new LabController(root);
