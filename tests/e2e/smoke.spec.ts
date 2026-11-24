import { expect, test } from "@playwright/test";

test("ESSVB-Reader smoke test: zero external network, Turkish default, sandboxed reader, v0.1.1", async ({
  page,
}) => {
  const externalRequests: string[] = [];

  page.on("request", (req) => {
    const url = req.url();
    const allowed =
      url.startsWith("http://127.0.0.1:4173") ||
      url.startsWith("data:") ||
      url.startsWith("blob:");
    if (!allowed) {
      externalRequests.push(url);
    }
  });

  await page.goto("/", { waitUntil: "networkidle" });

  // 1. Default Turkish UI & v0.1.1 version badge + offline startup update prompt
  await expect(page.getByTestId("header-version-pill")).toContainText("0.1.1");
  await expect(page.getByTestId("update-prompt-banner")).toBeVisible();
  await expect(page.getByTestId("nav-library-btn")).toContainText("Kütüphane");

  // 2. Create a shelf & verify it appears
  await page.getByTestId("new-shelf-input").fill("Bilim Kurgu");
  await page.getByTestId("create-shelf-btn").click();
  await expect(page.getByText("Bilim Kurgu")).toBeVisible();

  // 3. Open demo book & inspect strict sandbox iframe
  await page.getByTestId("open-book-demo-book-1").click();
  const iframe = page.getByTestId("reader-sandbox-iframe");
  await expect(iframe).toBeVisible();

  const sandboxAttr = await iframe.getAttribute("sandbox");
  expect(sandboxAttr).toBe("allow-same-origin");
  expect(sandboxAttr).not.toContain("allow-scripts");

  const frame = page.frameLocator('[data-testid="reader-sandbox-iframe"]');
  await expect(frame.locator("h1")).toContainText("Birinci Bölüm: Başlangıç");

  // Verify iframe <meta> CSP disables scripts and external connections
  const cspContent = await frame
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(cspContent).toContain("script-src 'none'");
  expect(cspContent).toContain("connect-src 'none'");

  // 4. Open About & Settings to verify v0.1.1, themes, and Gemini TTS off by default
  await page.getByTestId("nav-about-btn").click();
  await expect(page.getByTestId("about-version-text")).toContainText("0.1.1");

  await page.getByTestId("settings-tab-themes").click();
  await page.getByTestId("theme-preset-select").selectOption("sepia");

  await page.getByTestId("settings-tab-tts").click();
  await expect(page.getByTestId("gemini-enable-checkbox")).not.toBeChecked();

  await page.getByTestId("settings-tab-privacy").click();
  await expect(page.getByTestId("auto-update-checkbox")).toBeChecked();

  // 5. Assert ZERO external network requests occurred during the entire session
  expect(externalRequests).toEqual([]);
});
