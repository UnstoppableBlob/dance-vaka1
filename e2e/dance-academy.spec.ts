import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const PASSWORD = "MotionMatch123";
const TEACHER = "e2e_teacher";
const STUDENT_ONE = "e2e_student_one";
const STUDENT_TWO = "e2e_student_two";
const CLASS_NAME = "E2E beginner class";
const ASSIGNMENT = "E2E mirror combination";
const VIDEO_FIXTURE = path.join(__dirname, "fixtures", "dance.webm");

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
}

async function register(
  page: Page,
  username: string,
  role: "Teacher" | "Student",
) {
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByRole("radio", { name: role }).check();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(
    role === "Teacher" ? /\/teacher$/ : /\/student$/,
  );
}

async function uploadVideo(page: Page, verifyInvalidUpload = false) {
  const input = page.locator('input[type="file"]');

  if (verifyInvalidUpload) {
    await input.setInputFiles({
      name: "not-a-video.webm",
      mimeType: "video/webm",
      buffer: Buffer.from("this is not a video"),
    });
    await page.getByRole("button", { name: "Upload video" }).click();
    await expect(
      page.getByText(/The video could not be uploaded/),
    ).toBeVisible();
  }

  await input.setInputFiles(VIDEO_FIXTURE);
  await page.getByRole("button", { name: /Upload video|Retry upload/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Upload ready" }),
  ).toBeVisible();
}

async function acceptClassInvitation(page: Page) {
  await page.goto("/student");
  const invitation = page.locator("li").filter({ hasText: CLASS_NAME });
  await invitation.getByRole("button", { name: "Accept" }).click();
  await expect(
    page.getByRole("heading", { name: "Enrolled classes" }).locator(".."),
  ).toContainText(CLASS_NAME);
}

test("teacher and students complete the private-video grading workflow", async ({
  browser,
  page: anonymousPage,
}) => {
  await anonymousPage.goto("/teacher");
  await expect(anonymousPage).toHaveURL(/\/login$/);

  await anonymousPage.getByLabel("Username").fill("missing_user");
  await anonymousPage.getByLabel("Password").fill(PASSWORD);
  await anonymousPage.getByRole("button", { name: "Sign in" }).click();
  await expect(
    anonymousPage.getByText("Incorrect username or password.", { exact: true }),
  ).toBeVisible();

  const teacherContext = await browser.newContext();
  const studentOneContext = await browser.newContext();
  const studentTwoContext = await browser.newContext();
  const duplicateContext = await browser.newContext();
  const teacher = await teacherContext.newPage();
  const studentOne = await studentOneContext.newPage();
  const studentTwo = await studentTwoContext.newPage();

  try {
    await register(teacher, TEACHER, "Teacher");
    await register(studentOne, STUDENT_ONE, "Student");
    await register(studentTwo, STUDENT_TWO, "Student");

    const duplicate = await duplicateContext.newPage();
    await duplicate.goto("/register");
    await duplicate.getByLabel("Username").fill(TEACHER);
    await duplicate.getByRole("radio", { name: "Teacher" }).check();
    await duplicate.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await duplicate.getByLabel("Confirm password").fill(PASSWORD);
    await duplicate.getByRole("button", { name: "Create account" }).click();
    await expect(
      duplicate.getByText("That username is already in use.", { exact: true }),
    ).toBeVisible();

    await teacher.goto("/teacher");
    await teacher.getByLabel("Class name").fill(CLASS_NAME);
    await teacher
      .getByLabel(/Description/)
      .fill("Created by the deterministic browser suite.");
    await teacher.getByRole("button", { name: "Create class" }).click();
    await expect(teacher).toHaveURL(/\/teacher\/classes\/[^/]+$/);
    const classUrl = teacher.url();

    for (const username of [STUDENT_ONE, STUDENT_TWO]) {
      await teacher.getByLabel("Student username").fill(username);
      await teacher.getByRole("button", { name: "Send invitation" }).click();
      await expect(teacher.getByRole("status")).toHaveText(
        `Invitation sent to ${username}.`,
      );
    }

    await acceptClassInvitation(studentOne);
    await acceptClassInvitation(studentTwo);

    await teacher.goto(classUrl);
    const roster = teacher
      .getByRole("heading", { name: "Class roster" })
      .locator("..");
    await expect(roster).toContainText(STUDENT_ONE);
    await expect(roster).toContainText(STUDENT_TWO);

    await teacher.getByRole("link", { name: "New assignment" }).click();
    await teacher.getByLabel("Assignment title").fill(ASSIGNMENT);
    await teacher
      .getByLabel(/Instructions/)
      .fill("Mirror the combination from start to finish.");
    await uploadVideo(teacher, true);
    await expect(
      teacher.getByText("Uploaded reference selected"),
    ).toBeVisible();
    await teacher.getByRole("button", { name: "Create draft" }).click();
    await expect(teacher).toHaveURL(/\/assignments\/[^/]+$/);
    await expect(
      teacher.getByRole("heading", { name: ASSIGNMENT }),
    ).toBeVisible();
    teacher.once("dialog", (dialog) => dialog.accept());
    await teacher.getByRole("button", { name: "Publish assignment" }).click();
    await expect(
      teacher.getByText("Published", { exact: true }).first(),
    ).toBeVisible();

    await studentOne.goto("/student");
    await studentOne.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(studentOne);
    const studentAssignmentLink = studentOne
      .getByRole("link", { name: ASSIGNMENT })
      .first();
    const studentAssignmentUrl =
      await studentAssignmentLink.getAttribute("href");
    expect(studentAssignmentUrl).toMatch(/^\/student\/assignments\//);
    await studentAssignmentLink.click();
    await expect(studentOne).toHaveURL(/\/student\/assignments\/[^/]+$/);
    await uploadVideo(studentOne);
    await expect(studentOne.getByText("Response uploaded")).toBeVisible();
    await studentOne
      .getByRole("button", { name: "Submit and mark complete" })
      .click();
    await expect(studentOne.getByText("Assignment complete")).toBeVisible();

    await studentOne
      .getByRole("link", { name: "History", exact: true })
      .click();
    await expect(
      studentOne.getByRole("heading", { name: "Assignment history" }),
    ).toBeVisible();
    await expect(
      studentOne.getByRole("link", { name: ASSIGNMENT }),
    ).toBeVisible();
    await expect(studentOne.getByText("Grade not released")).toBeVisible();

    await teacher.goto(classUrl);
    await teacher.getByRole("link", { name: STUDENT_ONE }).click();
    await expect(
      teacher.getByRole("heading", { name: STUDENT_ONE }),
    ).toBeVisible();
    await teacher.getByRole("link", { name: ASSIGNMENT }).click();
    const gradingUrl = teacher.url();
    await teacher.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(teacher);
    await expect(teacher.getByLabel("Teacher reference video")).toBeVisible();
    await expect(teacher.getByLabel("Student response video")).toBeVisible();
    const analyzeButton = teacher.getByRole("button", {
      name: "Analyze videos",
    });
    await expect(analyzeButton).toBeEnabled();
    await analyzeButton.click();
    await expect(teacher.getByText("Analysis complete.")).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      teacher.getByRole("heading", { name: "Grade and feedback" }),
    ).toBeVisible();
    await teacher
      .getByLabel(/Written feedback/)
      .fill("Strong mirroring and consistent timing throughout.");
    await teacher.getByRole("button", { name: "Save draft" }).click();
    await expect(teacher.getByRole("status")).toHaveText("Draft saved.");
    teacher.once("dialog", (dialog) => dialog.accept());
    await teacher.getByRole("button", { name: "Save and release" }).click();
    await expect(teacher.getByRole("status")).toHaveText(
      "Grade released to the student.",
    );

    await studentOne.goto("/student");
    const releasedGrade = studentOne
      .getByRole("heading", { name: "Released grades" })
      .locator("..")
      .getByRole("link", { name: ASSIGNMENT });
    await expect(releasedGrade).toBeVisible();
    const gradeHref = await releasedGrade.getAttribute("href");
    expect(gradeHref).toMatch(/^\/student\/grades\//);
    await releasedGrade.click();
    await expect(
      studentOne.getByRole("heading", { name: "Final grade" }),
    ).toBeVisible();
    await expect(
      studentOne.getByText(
        "Strong mirroring and consistent timing throughout.",
      ),
    ).toBeVisible();

    await studentTwo.goto(gradeHref!);
    await expect(
      studentTwo.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();

    await studentTwo.goto(gradingUrl);
    await expect(studentTwo).toHaveURL(/\/student$/);
    await teacher.goto("/student");
    await expect(teacher).toHaveURL(/\/teacher$/);

    await studentTwo.goto(studentAssignmentUrl!);
    await expect(
      studentTwo.getByRole("heading", { name: ASSIGNMENT }),
    ).toBeVisible();
    await expect(studentTwo.getByText("Assignment complete")).not.toBeVisible();
  } finally {
    await Promise.all([
      teacherContext.close(),
      studentOneContext.close(),
      studentTwoContext.close(),
      duplicateContext.close(),
    ]);
  }
});
