import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";

import { PrismaClient } from "../src/generated/prisma/client";
import { InvitationStatus, UserRole } from "../src/generated/prisma/enums";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required to seed demo data.");
if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_DEMO_SEED !== "true"
) {
  throw new Error(
    "Demo seeding is disabled in production. Set ALLOW_DEMO_SEED=true only if intentional.",
  );
}

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD ?? "DanceAcademy123";
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const [teacher, student, invitedStudent] = await Promise.all([
      db.user.upsert({
        where: { usernameNormalized: "demo_teacher" },
        update: { passwordHash, role: UserRole.TEACHER, disabledAt: null },
        create: {
          username: "demo_teacher",
          usernameNormalized: "demo_teacher",
          passwordHash,
          role: UserRole.TEACHER,
        },
      }),
      db.user.upsert({
        where: { usernameNormalized: "demo_student" },
        update: { passwordHash, role: UserRole.STUDENT, disabledAt: null },
        create: {
          username: "demo_student",
          usernameNormalized: "demo_student",
          passwordHash,
          role: UserRole.STUDENT,
        },
      }),
      db.user.upsert({
        where: { usernameNormalized: "demo_invited" },
        update: { passwordHash, role: UserRole.STUDENT, disabledAt: null },
        create: {
          username: "demo_invited",
          usernameNormalized: "demo_invited",
          passwordHash,
          role: UserRole.STUDENT,
        },
      }),
    ]);

    const danceClass = await db.danceClass.upsert({
      where: {
        teacherId_nameNormalized: {
          teacherId: teacher.id,
          nameNormalized: "demo beginner class",
        },
      },
      update: {
        name: "Demo beginner class",
        description:
          "Local seed data for trying the teacher and student dashboards.",
        status: "ACTIVE",
        archivedAt: null,
      },
      create: {
        name: "Demo beginner class",
        nameNormalized: "demo beginner class",
        description:
          "Local seed data for trying the teacher and student dashboards.",
        teacherId: teacher.id,
      },
    });

    await db.classMembership.upsert({
      where: {
        classId_studentId: { classId: danceClass.id, studentId: student.id },
      },
      update: { removedAt: null },
      create: { classId: danceClass.id, studentId: student.id },
    });
    await db.classInvitation.upsert({
      where: {
        classId_studentId: {
          classId: danceClass.id,
          studentId: invitedStudent.id,
        },
      },
      update: {
        invitedUsernameNormalized: invitedStudent.usernameNormalized,
        status: InvitationStatus.PENDING,
        respondedAt: null,
        canceledAt: null,
        expiresAt: null,
      },
      create: {
        classId: danceClass.id,
        studentId: invitedStudent.id,
        invitedUsernameNormalized: invitedStudent.usernameNormalized,
      },
    });

    console.log("Demo seed complete.");
    console.log("Teacher: demo_teacher");
    console.log("Enrolled student: demo_student");
    console.log("Invited student: demo_invited");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo seed failed.");
  process.exitCode = 1;
});
