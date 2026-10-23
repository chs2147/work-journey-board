import { expect, test } from "@playwright/test";

test("브라우저 모드: 앱이 뜨고 sql.js가 동작하며 외부 요청이 없다", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol !== "data:")
      external.push(req.url());
  });

  await page.goto("/");
  await expect(page.locator("#root").getByText("Work Journey Board")).toBeVisible();
  await expect(page.getByRole("button", { name: "설정" })).toBeEnabled();
  await expect(page.getByTestId("journal-status")).toContainText(/SQLite 3\.\d+/);
  expect(external).toEqual([]);
});
