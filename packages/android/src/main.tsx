import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MobileApp } from "./MobileApp";

// Import Pennivo's design tokens and base styles
import "@pennivo/ui/styles/tokens.css";
import "@pennivo/ui/styles/base.css";
import "./mobile.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
