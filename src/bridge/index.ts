import type { Bridge } from "./bridge";
import { createFakeBridge, type FakeControls } from "./fake/fakeBridge";
import { createTauriBridge } from "./tauriBridge";

declare global {
  interface Window {
    /** Present only outside Tauri, so tests and previews can drive the fake core. */
    __ratelgitFake?: FakeControls;
  }
}

function guessPlatform() {
  const agent = navigator.userAgent;
  if (/Mac/i.test(agent)) return "macos" as const;
  if (/Win/i.test(agent)) return "windows" as const;
  return "linux" as const;
}

function selectBridge(): Bridge {
  if ("__TAURI_INTERNALS__" in window) return createTauriBridge();
  const empty =
    new URLSearchParams(window.location.search).get("fake") === "empty";
  const fake = createFakeBridge(guessPlatform(), { empty });
  window.__ratelgitFake = fake.controls;
  return fake;
}

export function defaultBridge(): Bridge {
  return selectBridge();
}

export * from "./bridge";
export * from "./types";
