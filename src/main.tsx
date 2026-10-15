import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./accessibility.css";
import "./reference-base.css";
import "./prototype.css";
import "./completion.css";
import "./license.css";
const sourceRepository = (
  import.meta.env.VITE_SOURCE_REPOSITORY ||
  "https://github.com/wincax88/Handlio"
).replace(/\/+$/, "");
const sourceRevision = import.meta.env.VITE_SOURCE_REVISION || "main";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <footer className="source-footer" aria-label="Handlio source and license">
      <span>© 2026 Handlio contributors</span>
      <a
        href={`${sourceRepository}/tree/${sourceRevision}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Source code
      </a>
      <a
        href={`${sourceRepository}/blob/${sourceRevision}/LICENSE`}
        target="_blank"
        rel="noopener noreferrer"
      >
        AGPL-3.0-only
      </a>
    </footer>
  </React.StrictMode>,
);
