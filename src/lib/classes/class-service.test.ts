import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClassStatus, UserRole } from "@/generated/prisma/enums";
import type { SafeUser } from "@/lib/auth/types";
import { dummyPasswordHash } from "@/lib/auth/password";
import {
  archiveTeacherClass,
  ClassAuthorizationError,
  ClassNameTakenError,
  createTeacherClass,
  DanceClassNotFoundError,
  getTeacherClass,
  listTeacherClasses,
  renameTeacherClass,
} from "@/lib/classes/class-service";
import { db } from "@/lib/db";

let teacherOne: SafeUser;
let teacherTwo: SafeUser;
let student: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueUsername(label: string) {
  sequence += 1;
  return `vitest_class_${label}_${Date.now().toString(36)}_${sequence}`.slice(
    0,
    40,
  );
}

async function createActor(role: UserRole, label: string): Promise<SafeUser> {
  const username = uniqueUsername(label);
  const user = await db.user.create({
    data: {
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: dummyPasswordHash,
      role,
    },
    select: { id: true, username: true, role: true },
  });
  createdUserIds.push(user.id);
  return user;
}

describe.sequential("teacher class management", () => {
  beforeAll(async () => {
    await db.danceClass.deleteMany({
      where: {
        teacher: { usernameNormalized: { startsWith: "vitest_class_" } },
      },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_class_" } },
    });

    teacherOne = await createActor(UserRole.TEACHER, "one");
    teacherTwo = await createActor(UserRole.TEACHER, "two");
    student = await createActor(UserRole.STUDENT, "student");
  });

  afterAll(async () => {
    await db.danceClass.deleteMany({
      where: { teacherId: { in: createdUserIds } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("creates a normalized class owned by the authenticated teacher", async () => {
    const danceClass = await createTeacherClass(teacherOne, {
      name: "  Beginner   Ballet  ",
      description: "  Tuesday evening group  ",
    });
    const stored = await db.danceClass.findUniqueOrThrow({
      where: { id: danceClass.id },
    });

    expect(danceClass.name).toBe("Beginner Ballet");
    expect(danceClass.description).toBe("Tuesday evening group");
    expect(stored.nameNormalized).toBe("beginner ballet");
    expect(stored.teacherId).toBe(teacherOne.id);
    expect(stored.status).toBe(ClassStatus.ACTIVE);
  });

  it("prevents duplicate normalized names for the same teacher", async () => {
    const name = `Technique ${Date.now().toString(36)}`;
    await createTeacherClass(teacherOne, { name, description: "" });

    await expect(
      createTeacherClass(teacherOne, {
        name: `  ${name.toUpperCase().replace(" ", "   ")}  `,
        description: "duplicate",
      }),
    ).rejects.toBeInstanceOf(ClassNameTakenError);

    await expect(
      createTeacherClass(teacherTwo, { name, description: "" }),
    ).resolves.toMatchObject({ name });
  });

  it("lists only the signed-in teacher's classes", async () => {
    const teacherOneClasses = await listTeacherClasses(teacherOne);
    const teacherTwoClasses = await listTeacherClasses(teacherTwo);

    expect(teacherOneClasses.length).toBeGreaterThan(0);
    expect(teacherTwoClasses.length).toBeGreaterThan(0);
    expect(
      teacherOneClasses.some((item) =>
        teacherTwoClasses.some((other) => other.id === item.id),
      ),
    ).toBe(false);
  });

  it("renames a class and updates its normalized uniqueness value", async () => {
    const danceClass = await createTeacherClass(teacherOne, {
      name: `Old Name ${Date.now().toString(36)}`,
      description: "",
    });
    const renamed = await renameTeacherClass(teacherOne, danceClass.id, {
      name: "  Advanced   Turns  ",
    });
    const stored = await db.danceClass.findUniqueOrThrow({
      where: { id: danceClass.id },
    });

    expect(renamed.name).toBe("Advanced Turns");
    expect(stored.nameNormalized).toBe("advanced turns");
    expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(
      danceClass.updatedAt.getTime(),
    );
  });

  it("archives without deleting history or changing the first archive time", async () => {
    const danceClass = await createTeacherClass(teacherOne, {
      name: `Archive ${Date.now().toString(36)}`,
      description: "retain me",
    });
    const archived = await archiveTeacherClass(teacherOne, danceClass.id);
    const archivedAgain = await archiveTeacherClass(teacherOne, danceClass.id);

    expect(archived.status).toBe(ClassStatus.ARCHIVED);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archivedAgain.archivedAt).toEqual(archived.archivedAt);
    expect(archivedAgain.description).toBe("retain me");
  });

  it("does not expose or mutate a class through another teacher", async () => {
    const danceClass = await createTeacherClass(teacherOne, {
      name: `Private ${Date.now().toString(36)}`,
      description: "",
    });

    await expect(
      getTeacherClass(teacherTwo, danceClass.id),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      renameTeacherClass(teacherTwo, danceClass.id, { name: "Stolen" }),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      archiveTeacherClass(teacherTwo, danceClass.id),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);

    await expect(
      getTeacherClass(teacherOne, danceClass.id),
    ).resolves.toMatchObject({
      name: danceClass.name,
      status: ClassStatus.ACTIVE,
    });
  });

  it("rejects class reads and mutations by students", async () => {
    await expect(listTeacherClasses(student)).rejects.toBeInstanceOf(
      ClassAuthorizationError,
    );
    await expect(
      createTeacherClass(student, { name: "Student Class", description: "" }),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);
    await expect(
      getTeacherClass(student, "11111111-1111-4111-8111-111111111111"),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);
  });
});
