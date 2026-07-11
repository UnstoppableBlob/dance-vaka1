import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AssignmentStatus,
  MediaAssetKind,
  MediaAssetStatus,
  UserRole,
} from "@/generated/prisma/enums";
import {
  archiveAssignmentDraft,
  ArchivedClassAssignmentError,
  AssignmentNotEditableError,
  AssignmentNotFoundError,
  AssignmentTitleTakenError,
  createAssignmentDraft,
  getTeacherAssignment,
  listTeacherAssignments,
  ReferenceVideoUnavailableError,
  updateAssignmentDraft,
} from "@/lib/assignments/assignment-service";
import { dummyPasswordHash } from "@/lib/auth/password";
import type { SafeUser } from "@/lib/auth/types";
import {
  archiveTeacherClass,
  ClassAuthorizationError,
  createTeacherClass,
  DanceClassNotFoundError,
} from "@/lib/classes/class-service";
import { db } from "@/lib/db";

let teacherOne: SafeUser;
let teacherTwo: SafeUser;
let student: SafeUser;
const createdUserIds: string[] = [];
let sequence = 0;

function uniqueValue(label: string, maxLength = 30) {
  sequence += 1;
  return `vitest_assign_${label}_${Date.now().toString(36)}_${sequence}`.slice(
    0,
    maxLength,
  );
}

async function createActor(role: UserRole, label: string): Promise<SafeUser> {
  const username = uniqueValue(label);
  const actor = await db.user.create({
    data: {
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: dummyPasswordHash,
      role,
    },
    select: { id: true, username: true, role: true },
  });
  createdUserIds.push(actor.id);
  return actor;
}

async function createClass(label: string) {
  return createTeacherClass(teacherOne, {
    name: uniqueValue(label, 100),
    description: "",
  });
}

async function createMediaAsset({
  ownerId = teacherOne.id,
  kind = MediaAssetKind.REFERENCE_VIDEO,
  status = MediaAssetStatus.READY,
}: {
  ownerId?: string;
  kind?: MediaAssetKind;
  status?: MediaAssetStatus;
} = {}) {
  return db.mediaAsset.create({
    data: {
      ownerId,
      kind,
      status,
      bucket: "assignment-test-bucket",
      objectKey: `assignment-tests/${uniqueValue("object", 80)}.webm`,
      originalFilename: "reference.webm",
      contentType: "video/webm",
      byteSize: BigInt(1024),
      uploadedAt: status === MediaAssetStatus.READY ? new Date() : null,
    },
  });
}

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    title: uniqueValue("draft", 100),
    instructions: null,
    dueAt: null,
    referenceVideoAssetId: null,
    ...overrides,
  };
}

describe.sequential("teacher assignment drafts", () => {
  beforeAll(async () => {
    await db.danceClass.deleteMany({
      where: {
        teacher: { usernameNormalized: { startsWith: "vitest_assign_" } },
      },
    });
    await db.mediaAsset.deleteMany({
      where: {
        owner: { usernameNormalized: { startsWith: "vitest_assign_" } },
      },
    });
    await db.user.deleteMany({
      where: { usernameNormalized: { startsWith: "vitest_assign_" } },
    });
    teacherOne = await createActor(UserRole.TEACHER, "teacher_one");
    teacherTwo = await createActor(UserRole.TEACHER, "teacher_two");
    student = await createActor(UserRole.STUDENT, "student");
  });

  afterAll(async () => {
    await db.danceClass.deleteMany({
      where: { teacherId: { in: createdUserIds } },
    });
    await db.mediaAsset.deleteMany({
      where: { ownerId: { in: createdUserIds } },
    });
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("creates, lists, and reads a normalized draft in an owned class", async () => {
    const danceClass = await createClass("create");
    const dueAt = new Date("2026-09-01T20:00:00.000Z");
    const draft = await createAssignmentDraft(teacherOne, danceClass.id, {
      title: "  Center   Combination  ",
      instructions: "Practice both sides",
      dueAt,
      referenceVideoAssetId: null,
    });
    const stored = await db.assignment.findUniqueOrThrow({
      where: { id: draft.id },
    });

    expect(draft).toMatchObject({
      title: "Center Combination",
      instructions: "Practice both sides",
      dueAt,
      status: AssignmentStatus.DRAFT,
    });
    expect(stored.titleNormalized).toBe("center combination");
    await expect(
      listTeacherAssignments(teacherOne, danceClass.id),
    ).resolves.toEqual([expect.objectContaining({ id: draft.id })]);
    await expect(
      getTeacherAssignment(teacherOne, danceClass.id, draft.id),
    ).resolves.toMatchObject({ id: draft.id });
  });

  it("enforces normalized title uniqueness within a class", async () => {
    const danceClass = await createClass("duplicate");
    await createAssignmentDraft(
      teacherOne,
      danceClass.id,
      draftInput({ title: "Pirouette Practice" }),
    );
    await expect(
      createAssignmentDraft(
        teacherOne,
        danceClass.id,
        draftInput({ title: "  PIROUETTE   PRACTICE " }),
      ),
    ).rejects.toBeInstanceOf(AssignmentTitleTakenError);

    const otherClass = await createClass("duplicate_other");
    await expect(
      createAssignmentDraft(
        teacherOne,
        otherClass.id,
        draftInput({ title: "Pirouette Practice" }),
      ),
    ).resolves.toMatchObject({ title: "Pirouette Practice" });
  });

  it("attaches and replaces only ready reference videos owned by the teacher", async () => {
    const danceClass = await createClass("reference");
    const firstVideo = await createMediaAsset();
    const secondVideo = await createMediaAsset();
    const draft = await createAssignmentDraft(
      teacherOne,
      danceClass.id,
      draftInput({ referenceVideoAssetId: firstVideo.id }),
    );
    expect(draft.referenceVideo).toMatchObject({
      id: firstVideo.id,
      status: MediaAssetStatus.READY,
      byteSize: 1024,
    });

    const updated = await updateAssignmentDraft(
      teacherOne,
      danceClass.id,
      draft.id,
      draftInput({
        title: "Updated reference draft",
        instructions: "New instructions",
        referenceVideoAssetId: secondVideo.id,
      }),
    );
    expect(updated).toMatchObject({
      title: "Updated reference draft",
      instructions: "New instructions",
      referenceVideo: { id: secondVideo.id },
    });
  });

  it("rejects pending, wrong-kind, foreign-owned, and already-used media", async () => {
    const danceClass = await createClass("bad_media");
    const pending = await createMediaAsset({
      status: MediaAssetStatus.PENDING_UPLOAD,
    });
    const wrongKind = await createMediaAsset({
      kind: MediaAssetKind.SUBMISSION_VIDEO,
    });
    const foreign = await createMediaAsset({ ownerId: teacherTwo.id });

    for (const assetId of [pending.id, wrongKind.id, foreign.id]) {
      await expect(
        createAssignmentDraft(
          teacherOne,
          danceClass.id,
          draftInput({ referenceVideoAssetId: assetId }),
        ),
      ).rejects.toBeInstanceOf(ReferenceVideoUnavailableError);
    }

    const used = await createMediaAsset();
    await createAssignmentDraft(
      teacherOne,
      danceClass.id,
      draftInput({ title: "First user", referenceVideoAssetId: used.id }),
    );
    await expect(
      createAssignmentDraft(
        teacherOne,
        danceClass.id,
        draftInput({ title: "Second user", referenceVideoAssetId: used.id }),
      ),
    ).rejects.toBeInstanceOf(ReferenceVideoUnavailableError);
  });

  it("archives without deleting and prevents later editing", async () => {
    const danceClass = await createClass("archive");
    const draft = await createAssignmentDraft(
      teacherOne,
      danceClass.id,
      draftInput(),
    );
    const archived = await archiveAssignmentDraft(
      teacherOne,
      danceClass.id,
      draft.id,
    );
    const archivedAgain = await archiveAssignmentDraft(
      teacherOne,
      danceClass.id,
      draft.id,
    );

    expect(archived.status).toBe(AssignmentStatus.ARCHIVED);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archivedAgain.archivedAt).toEqual(archived.archivedAt);
    await expect(
      updateAssignmentDraft(teacherOne, danceClass.id, draft.id, draftInput()),
    ).rejects.toBeInstanceOf(AssignmentNotEditableError);
    expect(await db.assignment.count({ where: { id: draft.id } })).toBe(1);
  });

  it("blocks archived classes, other teachers, and students", async () => {
    const danceClass = await createClass("authorization");
    const draft = await createAssignmentDraft(
      teacherOne,
      danceClass.id,
      draftInput(),
    );

    await expect(
      getTeacherAssignment(teacherTwo, danceClass.id, draft.id),
    ).rejects.toBeInstanceOf(AssignmentNotFoundError);
    await expect(
      listTeacherAssignments(teacherTwo, danceClass.id),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      updateAssignmentDraft(teacherTwo, danceClass.id, draft.id, draftInput()),
    ).rejects.toBeInstanceOf(DanceClassNotFoundError);
    await expect(
      createAssignmentDraft(student, danceClass.id, draftInput()),
    ).rejects.toBeInstanceOf(ClassAuthorizationError);

    await archiveTeacherClass(teacherOne, danceClass.id);
    await expect(
      createAssignmentDraft(teacherOne, danceClass.id, draftInput()),
    ).rejects.toBeInstanceOf(ArchivedClassAssignmentError);
    await expect(
      updateAssignmentDraft(teacherOne, danceClass.id, draft.id, draftInput()),
    ).rejects.toBeInstanceOf(ArchivedClassAssignmentError);
  });
});
