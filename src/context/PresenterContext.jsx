"use client";

/**
 * PresenterContext — how a finished answer's chips and the step bar reach the Demo panel (presenter panels design §6,
 * 2026-10-07). The page provides `openDemoPanel`, `openPassages` and `closeDemoPanel`; a consumer outside the provider
 * (a unit render, a storybook) gets no-ops. The chat panel itself is pinned by the frozen suites (no fetch, the citation
 * chip byte for byte), so the coding chips reach the panel through this context, never through a new prop on it.
 */
import React, { createContext, useContext } from "react";

const noop = () => {};

export const PresenterContext = createContext({
  demoOpen: false,
  openDemoPanel: noop,
  openPassages: noop,
  closeDemoPanel: noop,
  // PR B: the Results and Documents panels.
  openResults: noop,
  openDocuments: noop,
});

export function usePresenter() {
  return useContext(PresenterContext);
}

export function PresenterProvider({ value, children }) {
  return <PresenterContext.Provider value={value}>{children}</PresenterContext.Provider>;
}
