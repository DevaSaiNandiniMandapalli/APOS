import { expect, test } from "@playwright/test";

test("static export exposes the Next.js prefetch payloads the client requests", async ({ request }) => {
  const paths = [
    "/__next.__PAGE__.txt",
    "/faq/__next.faq.__PAGE__.txt",
    "/tools/__next.tools.__PAGE__.txt",
    "/tools/pdf-forms/__next.tools.$d$toolId.__PAGE__.txt",
    "/studios/pdf-editor/__next.studios.$d$studioId.__PAGE__.txt",
  ];
  for (const path of paths) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect((await response.text()).length, path).toBeGreaterThan(100);
  }
});
