import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Seed = {
  email: string;
  password: string;
};

let seed: Seed;

test.beforeAll(async () => {
  seed = JSON.parse(await readFile(path.resolve("e2e/.auth/seed.json"), "utf8")) as Seed;
});

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test("signed-out visitors are redirected away from protected daily notes", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto(`/notes/${todayISO()}`);

  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();

  await context.close();
});

test("user can sign in, sign out, and back cannot restore protected content", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(seed.email);
  await page.getByLabel(/password/i).fill(seed.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page).not.toHaveURL(/\/auth/);
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();

  await context.close();
});