import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, applyStartupAppearance } from "@pennivo/ui";

const root = document.getElementById("root");
if (root) {
  // Apply saved width and font settings before React renders so the editor's
  // first layout already has them (no post-mount style write; see
  // startupAppearance.ts). applyStartupAppearance never rejects.
  void applyStartupAppearance().then(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
