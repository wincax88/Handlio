import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import { SourceFooter } from "./SourceFooter";
import "./styles.css";
import "./accessibility.css";
import "./reference-base.css";
import "./prototype.css";
import "./completion.css";
import "./license.css";
const content = (
  <React.StrictMode>
    <App />
    <SourceFooter />
  </React.StrictMode>
);
const root = document.getElementById("root")!;
if (root.dataset.prerendered) hydrateRoot(root, content);
else createRoot(root).render(content);
