import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme } from "./state/theme";
import { suppressNativeContextMenu } from "./lib/nativeContextMenu";
import "./styles/tokens.css";
import "./styles/global.css";

applyTheme();
suppressNativeContextMenu();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
