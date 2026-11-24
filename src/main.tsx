import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { defaultBridge } from "./bridge";
import { StoreProvider } from "./state/context";
import { createAppStore } from "./state/store";
import { MenuProvider } from "./ui/menu";
import "./styles/base.css";
import "./styles/controls.css";
import "./styles/overlays.css";
import "./styles/sidebar.css";
import "./styles/workspace.css";
import "./styles/history.css";
import "./styles/diff.css";
import "./styles/changes.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const store = createAppStore(defaultBridge());

createRoot(root).render(
  <StrictMode>
    <StoreProvider store={store}>
      <MenuProvider>
        <App />
      </MenuProvider>
    </StoreProvider>
  </StrictMode>,
);
