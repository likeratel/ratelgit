import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import type { AppStore } from "./store";
import type { AppState } from "./types";

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({
  store,
  children,
}: {
  store: AppStore;
  children: ReactNode;
}) {
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

/** Subscribes to part of the app state. */
export function useApp<T>(selector: (state: AppState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useApp must be used inside StoreProvider");
  return useStore(store, selector);
}

/** The store itself, for reading the latest state inside event handlers. */
export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useAppStore must be used inside StoreProvider");
  return store;
}
