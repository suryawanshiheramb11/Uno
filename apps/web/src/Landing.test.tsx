import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Landing page", () => {
  it("renders title, tagline and a sign-in link to /sign-in", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderAt("/");
    expect(screen.getByRole("heading", { name: "UNO" })).toBeTruthy();
    expect(screen.getByText(/Classic and No Mercy/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
  });

  it("shows the environment from /api/health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, environment: "staging", version: "x" })),
      ),
    );
    renderAt("/");
    await waitFor(() => expect(screen.getByTestId("status-pill").textContent).toContain("staging"));
  });

  it("shows offline when the health request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("net"))),
    );
    renderAt("/");
    await waitFor(() => expect(screen.getByTestId("status-pill").textContent).toContain("Offline"));
  });

  it("renders the landing page for unknown paths", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderAt("/does/not/exist");
    expect(screen.getByRole("heading", { name: "UNO" })).toBeTruthy();
  });
});
