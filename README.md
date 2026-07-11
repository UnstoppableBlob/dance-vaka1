# MotionMatch

MotionMatch is a Khan Academy-style classroom app for dance instruction. Teachers publish private reference videos, students submit recorded attempts, and teachers review browser-generated pose-similarity estimates before releasing a grade. The complete teacher and student workflow is implemented and covered by unit, integration, and browser tests.

## Stack

- Next.js 16 App Router, React 19, TypeScript, and Tailwind CSS 4
- PostgreSQL 17 with Prisma ORM 7 and the `pg` driver adapter
- Browser MediaRecorder capture with private, presigned S3-compatible video storage through the AWS SDK
- MediaPipe Tasks Vision Pose Landmarker with a custom TypeScript pose, motion, timing, and coverage comparison engine
- Supabase Postgres and S3-compatible Storage for production, with MinIO and PostgreSQL containers for local development
- Vercel hosting, Server Components, Server Actions, and server-only data/storage modules
- Argon2id password hashing and opaque, HMAC-protected database sessions
- Vitest unit/integration coverage and Playwright end-to-end browser tests

The app uses Server Components by default. Database and object-storage modules import `server-only` so credentials and privileged clients cannot enter browser bundles.

## Architecture

```text
Browser
  ├─ Next.js Server Components and Server Actions
  │    ├─ authorization and domain services
  │    └─ Prisma adapter ── PostgreSQL
  ├─ short-lived signed PUT/GET URLs ── private S3-compatible storage
  └─ MediaPipe WASM/model + local pose comparison ── grading UI
```

- Server Components perform protected reads; Server Actions validate mutations and call role/ownership-scoped domain services.
- PostgreSQL stores accounts, sessions, classes, assignment snapshots, submissions, compact grade summaries, media metadata, and persistent rate-limit buckets.
- Video bytes bypass the Next.js server and move directly between the browser and private object storage through short-lived signed URLs. Database media records remain pending until storage metadata and file signatures are verified.
- Pose landmarks are computed and compared in the grading browser. Raw landmarks are not persisted; only the aggregate analysis selected by the teacher is stored.
- `src/proxy.ts` provides early missing-session redirects. Data-access and service authorization remain the security boundary.

## Requirements

- Node.js 20.19 or newer
- npm
- Docker with Docker Compose

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

   The committed values are development-only defaults, not production secrets.

3. Start PostgreSQL and MinIO:

   ```bash
   npm run services:up
   ```

4. Apply the database migrations:

   ```bash
   npm run db:migrate
   ```

5. Optionally add repeatable local demo accounts and a class:

   ```bash
   npm run db:seed
   ```

6. Start the app:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000`. The MinIO administration console is at `http://localhost:9001` and uses the local S3 credentials from `.env`.

Stop local services with `npm run services:down`. Add `-- -v` to that command only when you deliberately want to delete the local database and stored videos.

## Demo seed

`npm run db:seed` is idempotent and creates `demo_teacher`, enrolled student `demo_student`, invited student `demo_invited`, and `Demo beginner class`. Their default local password is `MotionMatch123`; set `SEED_DEMO_PASSWORD` to replace it. The seed intentionally does not create fake media or grades, so those security-sensitive flows still use the real signed-upload path.

Demo seeding refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is explicitly supplied. Do not seed predictable demo credentials into a public deployment.

## Environment variables

| Name                   | Purpose                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`         | PostgreSQL connection string used by Prisma and the app                           |
| `TEST_DATABASE_URL`    | Separate PostgreSQL database used by auth integration tests                       |
| `POSTGRES_USER`        | Local PostgreSQL container user                                                   |
| `POSTGRES_PASSWORD`    | Local PostgreSQL container password                                               |
| `POSTGRES_DB`          | Local PostgreSQL database name                                                    |
| `POSTGRES_PORT`        | Local host port for PostgreSQL; defaults to `5433`                                |
| `APP_ORIGIN`           | Browser origin allowed to access local MinIO; defaults to `http://localhost:3000` |
| `S3_REGION`            | Storage region; MinIO accepts `us-east-1`                                         |
| `S3_ENDPOINT`          | Optional S3-compatible endpoint; use the MinIO URL locally                        |
| `S3_BUCKET`            | Private media bucket                                                              |
| `S3_ACCESS_KEY_ID`     | S3/MinIO access key                                                               |
| `S3_SECRET_ACCESS_KEY` | S3/MinIO secret key                                                               |
| `S3_FORCE_PATH_STYLE`  | Required by local MinIO; generally false for AWS S3                               |
| `SESSION_SECRET`       | HMAC pepper for stored session-token hashes; use 32+ random characters            |
| `MEDIA_CLEANUP_SECRET` | Separate 32+ character bearer secret for the abandoned-upload cleanup endpoint    |
| `SEED_DEMO_PASSWORD`   | Optional local password override used only by `npm run db:seed`                   |
| `ALLOW_DEMO_SEED`      | Explicit production safety override for demo seeding; normally unset              |

No server secret should use a `NEXT_PUBLIC_` prefix.

## Data model

The Prisma schema includes:

- `User` with one immutable `TEACHER` or `STUDENT` role, a display username, and a separately normalized unique username
- hashed session-token records with expiry and revocation support
- teacher-owned classes, student invitations, and auditable memberships
- draft/published/archived assignments and a snapshot of assigned students
- student video submissions and completion timestamps
- automated score breakdowns, teacher overrides, feedback, and grade release state
- private media records that track object ownership and connect reference/submission videos to domain records
- HMAC-keyed, expiring rate-limit buckets that do not store raw usernames or client addresses

Normalized username, class-name, and assignment-title values are application invariants. Mutations added in later prompts must write them in the same transaction as their display values and must enforce role/ownership checks on the server.

## Authentication

- Registration accepts a unique 3–30 character username, password confirmation, and one permanent `TEACHER` or `STUDENT` role.
- Usernames retain their display casing while uniqueness and login use an NFKC-normalized lowercase value.
- Passwords require at least 12 characters with uppercase, lowercase, and a number, and are stored only as Argon2id hashes.
- The browser receives a 256-bit opaque token in an HttpOnly, SameSite=Lax cookie. Only an HMAC-SHA256 hash is stored in PostgreSQL.
- Successful login rotates the current session; sign-out deletes it from both the database and browser.
- `src/lib/auth/dal.ts` validates the database session and role at protected pages. `src/proxy.ts` provides an early missing-cookie redirect but is not the security boundary.
- Authenticated users are routed to `/teacher` or `/student`; cross-role requests return to the user's correct dashboard.

## Teacher classes

- `/teacher` lists active and archived classes and contains the create-class form.
- `/teacher/classes/[classId]` shows one owned class, its timestamps and counts, plus rename/archive controls.
- Class names are trimmed, Unicode-normalized, whitespace-collapsed, and compared case-insensitively per teacher.
- Archiving records `archivedAt` and preserves the class and its future roster/assignment history.
- Class services require a TEACHER actor and scope every read and mutation by `teacherId`; another teacher receives the same not-found result as an unknown class.

## Student invitations

- A teacher can invite an existing student from an active class using the student's exact username; no broad username-search endpoint exists.
- Username matching is case-insensitive, but pending invitations display the student's saved username casing.
- Missing, disabled, and non-student targets share one privacy-safe error response.
- Active memberships and duplicate pending invitations are rejected. Canceled/declined historical invitations can be safely reused instead of creating duplicate records.
- Teachers can list and cancel pending invitations only inside classes they own.
- `/student` shows invitations addressed to the signed-in student. Accepting atomically marks the invitation accepted and creates or reactivates membership; declining records the response without enrolling the student.
- Expired, canceled, previously answered, archived-class, and other students' invitations cannot be used to join a class.

## Class memberships

- Students see their current enrolled classes on `/student`, including an archived label when applicable.
- A teacher's class page shows only active roster members. Removing a student timestamps `removedAt` instead of deleting membership history.
- A removed student can be invited again; acceptance reactivates the original membership record with a fresh `joinedAt` timestamp.
- Student and teacher service methods enforce role, invitation ownership, and teacher class ownership independently of the UI.

## Object storage

`src/lib/storage` exposes a provider-neutral `ObjectStorage` interface. Its S3 implementation creates short-lived upload/read URLs, reads metadata, and deletes objects. Object keys are collision-resistant and partitioned by purpose and owner. Application code should store keys and metadata, never permanent public URLs.

The media service accepts MP4, WebM, MOV, and M4V videos up to 250 MB. It checks that the extension matches the MIME type, permits teachers to create reference videos and students to create submission videos, and issues five-minute signed URLs. An upload begins as `PENDING_UPLOAD`; the client must upload with the returned `Content-Type`, then call the completion action. Completion performs an S3 metadata check for the exact type and byte count before changing the record to `READY`. Read URLs require the signed-in owner and a ready record, except that an assignment recipient receives scoped access to that published assignment's ready reference video.

## Browser video recorder

- `src/components/media/video-recorder.tsx` provides camera/microphone permission handling, live preview, recording time, review/discard, existing-file selection, upload progress, retry, and successful asset callbacks.
- It selects a MediaRecorder format supported by the current browser, normalizes the upload MIME type, warns before navigation while recording, and releases tracks, upload requests, timers, and object URLs when discarded or unmounted.
- Camera recording requires a secure browser context (`https://` or localhost). File selection remains available when recording APIs or devices are unavailable.

## Assignment drafts

- A teacher's class page lists draft and archived assignments and links to creation and detail pages.
- Drafts contain a normalized title unique within the class, optional instructions, an optional UTC due date, and an optional ready reference video.
- Reference videos can be recorded or selected with the reusable browser recorder. The data layer accepts only ready `REFERENCE_VIDEO` assets owned by the class teacher and prevents one asset from being attached to multiple assignments.
- Draft creation, editing, viewing, and archiving are scoped through both the teacher and class. Archived assignments remain viewable but cannot be edited, and archived classes cannot create or edit drafts.

## Assignment publishing

- Publishing requires an active draft with a ready teacher-owned reference video and moves it to `PUBLISHED` with an audit timestamp.
- Publication and recipient creation run in one serializable transaction. The recipient rows snapshot exactly the class memberships active in that transaction.
- Later roster additions and removals do not silently change existing assignment recipients. A published assignment page identifies active students who enrolled afterward and lets the teacher explicitly assign the work to them.
- The student dashboard reads through `AssignmentStudent`, so students see only published assignments explicitly assigned to them. It derives Not started, In progress, Late, and Completed from the due date and the student's own submission state.

## Student submissions

- Assignment names on `/student` link to a recipient-scoped detail page with private reference-video playback, instructions, due date, and the reusable response recorder.
- Submitting verifies a ready `SUBMISSION_VIDEO` owned by that student, then attaches it and records submitted/completed timestamps in one serializable transaction.
- Late work is accepted and identified by comparing the latest submission time with the assignment due date.
- A student may replace a completed response until a `Grade` record exists. Once grading begins, both the service and UI lock replacement; students can never submit to unpublished, unassigned, or another student's work.

## Teacher dashboard

- `/teacher` shows active/archived classes, pending invitation totals, published-assignment completion counts, recent submissions, and completed work without a grade record.
- Dashboard queries are bounded and started in parallel. Every list and count independently scopes through `teacherId`; no aggregate depends on filtering another teacher's data in application memory.
- Recent and ungraded submission rows link to a teacher-owned submission summary, while classes, invitations, and assignment progress link directly to their existing management pages.

## Teacher student history and grading context

- Student names in a class roster link to `/teacher/classes/[classId]/students/[studentId]`, which lists every assignment snapshotted to that student with assignment status, completion date, and grade status.
- Completed assignment names link to a dedicated nested grading route. The route loads the exact assignment reference record and that student's completed submission record, then provides short-lived private URLs for both videos.
- History and grading queries require the teacher to own the class and require a real class membership record for the student. Removed memberships remain eligible for historical review because removal timestamps rather than deletes the relationship.
- A different teacher, an unrelated student ID, an assignment from another class, or an incomplete submission receives the same unavailable/not-found result and no media access.

## Student dashboard and history

- `/student` shows enrolled classes, pending invitations, upcoming/current work, late work, recent completions, and only grades explicitly marked `RELEASED`.
- Assignment links remain scoped through the signed-in student's immutable recipient record. Completed work links to `/student/history`, which paginates ten submissions at a time.
- Released grade links open `/student/grades/[gradeId]` with the final score, available score breakdown, and teacher feedback. Draft grades appear only as “not released”; their IDs, scores, and feedback are not returned to students.
- Dashboard, history, and grade-detail queries independently require the `STUDENT` role and scope assignment, submission, and grade relations by the signed-in student's ID. Another student's work and direct grade IDs return no data.

Call `POST /api/internal/media/cleanup` from a trusted scheduler with `Authorization: Bearer $MEDIA_CLEANUP_SECRET`. It claims pending uploads older than 24 hours before deleting their objects, so it cannot delete an upload concurrently promoted to ready. Failed object deletions restore the pending record for a later retry. The same authenticated maintenance call removes expired sessions and rate-limit buckets. Keep this endpoint and secret private.

The local MinIO initialization container creates a private bucket and configures cluster-wide CORS for `APP_ORIGIN`; current community MinIO releases do not support bucket-level CORS configuration. For production, configure a private S3-compatible bucket, narrow bucket CORS rules to the app origin and `PUT`/`GET`/`HEAD`, use short URL lifetimes, encryption, lifecycle/retention policies, and credentials limited to this bucket. Omit `S3_ENDPOINT` for AWS S3 and set `S3_FORCE_PATH_STYLE=false`.

## Commands

| Command                   | Action                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`             | Start the development server                                                           |
| `npm run build`           | Generate Prisma Client and create a production build                                   |
| `npm run start`           | Start the production server                                                            |
| `npm run lint`            | Run ESLint                                                                             |
| `npm run format`          | Format maintained source and documentation with Prettier                               |
| `npm run format:check`    | Check maintained source and documentation formatting                                   |
| `npm run test`            | Migrate the isolated test database and run Vitest                                      |
| `npm run test:e2e`        | Reset isolated E2E data, build the app, and run the Chromium workflow suite            |
| `npm run test:watch`      | Run Vitest in watch mode                                                               |
| `npm run typecheck`       | Generate Prisma Client and run TypeScript checks                                       |
| `npm run check`           | Run lint and type checking                                                             |
| `npm run db:generate`     | Regenerate Prisma Client                                                               |
| `npm run db:migrate`      | Create/apply a development migration                                                   |
| `npm run db:deploy`       | Apply committed migrations in production                                               |
| `npm run db:seed`         | Idempotently create local demo accounts and a class                                    |
| `npm run db:verify-clean` | Verify migrations and idempotent seeding in a temporary clean database, then remove it |
| `npm run db:studio`       | Open Prisma Studio                                                                     |
| `npm run services:up`     | Start PostgreSQL and MinIO                                                             |
| `npm run services:down`   | Stop local services without deleting data                                              |

## Comparator prototype

The original [`compare.html`](./compare.html) remains unchanged at the repository root. It is a reference implementation for the later grading workflow and is not currently a public Next.js route.

The pure, browser-safe comparison engine is in `src/lib/pose-comparison`. Separate typed modules handle landmark validation, torso-based normalization, mirrored candidates, point/limb/joint comparison, motion energy, timing, pose coverage, weighted aggregation, mismatch counting, and feedback text. The extracted calculations have no DOM or MediaPipe dependency, so recorded landmark frames can be tested deterministically and supplied by the browser analysis page in Prompt 15.

## Browser grading analysis

- The authorized teacher grading route automatically supplies its private reference and submission URLs to a client-only analysis component; teachers do not select files again.
- MediaPipe Pose Landmarker is loaded only after the teacher starts analysis. The browser samples aligned points across both clips, runs the extracted comparison engine locally, and does not upload landmarks or estimates.
- The page provides side-by-side playback, skeleton overlays, prominent analysis progress, score estimates, feedback, a sampled-frame timeline, and matched-frame review. Videos buffer automatically before analysis, which samples up to 8 frames per second with a 432-frame cap. Each page supports one analysis run; estimates are explicitly labeled as assistive rather than automatic final grades.
- Analysis prevents overlapping runs, falls back from GPU to CPU model execution, handles missing poses and video/model errors, and closes the model plus pending video operations when the page unmounts.
- MediaPipe WASM and the lite pose model currently load from the pinned jsDelivr and Google model URLs used by the prototype, so the grading browser needs network access to those hosts.

## End-to-end browser tests

- `npm run test:e2e` starts the local services, resets the dedicated `dance_academy_e2e` database, empties the private `dance-academy-e2e` bucket, applies migrations, creates a production build, and runs Playwright in Chromium. On exit it restores the normal `.env` Compose configuration.
- The suite registers one teacher and two students, exercises invitation acceptance, reference and response uploads, publication, completion, student history, analysis, draft/release grading, and student grade viewing. It also covers unauthenticated and cross-role redirects, cross-student grade isolation, duplicate registration, invalid login, and rejection of a fake video upload.
- The committed `e2e/fixtures/dance.webm` clip is intentionally tiny. E2E builds enable a deterministic pose-landmark provider while still loading, seeking, comparing, and displaying the real private videos. Normal builds leave this test-only provider disabled and use MediaPipe.

## Grade drafts and release

- An authorized class teacher can save the current aggregate analysis, written feedback, and an optional final-score override. Overrides require a written reason, and every score is validated as a whole number from 0 through 100.
- Only the compact score/mismatch summary is persisted; browser landmark frames remain local. Rerunning analysis replaces the saved automated breakdown when the next draft is saved.
- Saving the first draft creates the grade record and immediately locks student response replacement. Saving and releasing writes the current form atomically, timestamps the release, and makes the result visible on the student's dashboard, history, and grade page.
- Draft grades remain teacher-only. Released grades are read-only, and grade mutations independently scope the completed submission through the signed-in teacher's class ownership.

## Navigation and accessibility

- Authenticated pages share role-aware dashboard navigation, and nested class, assignment, student, submission, history, grade, and grading pages use a consistent breadcrumb trail.
- The application includes a keyboard skip link, strong global focus indicators, reduced-motion handling, labeled loading states, friendly error/404 states, and confirmation prompts for destructive or irreversible actions.
- Recorder file selection is keyboard operable, status and validation messages use appropriate live-region semantics, and recording/grading layouts wrap for narrow screens.
- Video interfaces include accessible labels, caption tracks, and visible guidance that captions are not generated automatically. Spoken directions needed for an assignment should also be included as written instructions.

## Production notes

- Provision a managed PostgreSQL database with TLS and appropriate connection pooling, plus a private S3-compatible bucket in the same region as the app where practical.
- Supply all variables from `.env.example` through the deployment platform with new production secrets. For AWS S3, omit `S3_ENDPOINT`, set `S3_FORCE_PATH_STYLE=false`, and use credentials restricted to the application bucket.
- Configure bucket CORS for the exact deployed `APP_ORIGIN`, allowing browser `PUT`, `GET`, and `HEAD` requests and the `Content-Type` header. Do not enable anonymous/public reads.
- Run `npm run db:deploy` before serving a release, then `npm run build` and `npm run start`. On platforms with a separate build phase, apply migrations from a controlled release job rather than from every app instance.
- Schedule authenticated `POST /api/internal/media/cleanup` calls with `Authorization: Bearer $MEDIA_CLEANUP_SECRET` to remove expired sessions, rate-limit records, and abandoned uploads.
- Run `npm run db:verify-clean`, `npm test`, `npm run test:e2e`, `npm run check`, `npm audit`, and `npm run build` in release CI. Local database-backed checks require Docker.
- MediaPipe analysis requires browser WebAssembly/video decoding support and network access to the pinned jsDelivr WASM assets and Google-hosted pose model. The CSP already permits those hosts; mirror and update both URLs/CSP if self-hosting them.

### Vercel with Cloudflare R2

The existing S3 storage adapter works with Cloudflare R2 without application-code changes. Create a private R2 bucket and an Object Read & Write API token restricted to that bucket. Keep the bucket's public development URL disabled.

Configure these variables in the Vercel project for Production. Add them to Preview only if preview deployments should use their own database and bucket; do not connect untrusted previews to production data.

| Variable               | Production value                                           |
| ---------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`         | Pooled TLS URL from a managed PostgreSQL provider          |
| `S3_REGION`            | `auto`                                                     |
| `S3_ENDPOINT`          | `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_BUCKET`            | The private R2 bucket name                                 |
| `S3_ACCESS_KEY_ID`     | Access Key ID from the bucket-scoped R2 token              |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key from the bucket-scoped R2 token          |
| `S3_FORCE_PATH_STYLE`  | `false`                                                    |
| `SESSION_SECRET`       | A new random value of at least 32 characters               |
| `MEDIA_CLEANUP_SECRET` | A different new random value of at least 32 characters     |

`TEST_DATABASE_URL`, `POSTGRES_*`, `POSTGRES_PORT`, and `APP_ORIGIN` are only needed by the local Docker/test setup, not by the Vercel runtime.

Browser uploads, video playback, and grading require an R2 CORS rule. Replace the example origin with the final Vercel or custom-domain origin; origins must not end with `/`.

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```

For local development against R2, add `http://localhost:3000` as another allowed origin. Vercel preview URLs change per deployment, so use a stable preview domain or add the exact preview origin rather than opening CORS to every origin.

From the repository root, install and authenticate the Vercel CLI, link this single-project repository, and set the variables above in Project Settings or with `vercel env add <NAME> production`. Then apply the committed Prisma migrations and deploy:

```bash
vercel login
vercel link
vercel env run -e production -- npm run db:deploy
vercel --prod
```

After deployment, test one teacher upload, one student upload, video playback, and grading in the browser. An R2 `403` usually means the endpoint, token scope, signed `Content-Type`, or system clock is wrong; a browser CORS error means the deployed origin, method, or requested header is missing from the bucket rule.

## Implemented functionality

- Teacher/student registration, login, logout, durable sessions, role redirects, and server-side authorization
- Teacher-owned class lifecycle, username invitations, student responses, historical memberships, and active rosters
- Private reference/response recording or file upload with signed URLs, ownership checks, verification, and cleanup
- Assignment drafts, publishing with immutable recipient snapshots, student status tracking, completion, and controlled replacement
- Teacher dashboard, student dashboard/history, teacher student-history pages, and private grading routes
- Browser-local pose extraction/comparison, assistive score breakdowns, teacher feedback/overrides, grade drafts, release, and student-only released results
- Responsive keyboard-accessible navigation, confirmation/error/empty states, secure headers, persistent rate limits, and authorization regression coverage

## Known limitations

- Pose similarity is an assistive estimate, not an authoritative assessment. Camera angle, framing, lighting, occlusion, loose clothing, and different choreography timing can materially affect scores.
- MediaPipe assets currently load from third-party CDNs at analysis time; an offline grading deployment must self-host the pinned WASM and model files.
- Videos are not transcoded, compressed, captioned, virus-scanned, or uploaded in resumable chunks. Users must provide a browser-decodable MP4, WebM, MOV, or M4V file within the 250 MB limit.
- Camera recording requires HTTPS or localhost and user permission. Automated E2E coverage runs in Chromium; Safari/Firefox and real mobile camera capture remain manual acceptance targets.
- The cleanup endpoint requires an external scheduler. Released grades are intentionally immutable, and each class currently has one owning teacher.

## Manual acceptance checklist

- [ ] Copy `.env.example`, start services, run migrations and the optional seed, then open `/login` without console/startup errors.
- [ ] Register a teacher and two students; verify invalid credentials, duplicate usernames, unauthenticated routes, and cross-role routes are denied safely.
- [ ] Create a class, invite both students, accept invitations, and confirm the teacher roster and student enrolled-class views.
- [ ] Upload or record a teacher reference, create and publish an assignment, and confirm only snapshotted recipients can open its private video.
- [ ] Submit a student response, mark it complete, and confirm it appears in student history and teacher work-to-review/history views.
- [ ] Open grading, verify both private videos play, run analysis, save a draft, release it, and confirm only that student sees the score and feedback.
- [ ] Repeat the dashboard, assignment upload, and grading checks near 390 px width; confirm keyboard focus, dialogs, recorder controls, and no horizontal overflow.
- [ ] Confirm direct MinIO/S3 anonymous object access is denied, expired signed URLs fail, and scheduled cleanup authentication rejects a wrong secret.
- [ ] Run every release command in the Commands section and review deployment environment/CORS values before promotion.

## Security hardening

- Every protected page, server action, domain query, and media operation enforces its role and ownership at the data layer. User-controlled IDs do not grant access, redirects are fixed or use validated database IDs, and React renders saved text without raw HTML injection.
- Next.js Server Actions retain their same-origin checks; session cookies are HttpOnly, SameSite=Lax, Secure in production, and rotated at login. CSP `form-action 'self'`, framing denial, MIME-sniffing prevention, permissions policy, referrer policy, COOP, and HSTS are applied globally.
- Server Action request bodies are capped at 1 MB. Authentication and invitation attempts use persistent, transactionally serialized limits keyed with HMAC hashes; both per-account/target and client-address limits are applied.
- Video uploads retain private, short-lived S3 URLs and size/MIME/extension checks. Completion also reads the object prefix and verifies WebM or ISO media signatures, rejecting HTML or other content mislabeled as video.
- Logs use generic operation messages without credentials, tokens, usernames, object keys, or submitted content. Scheduled maintenance removes expired sessions, abandoned uploads, and expired rate-limit buckets.
- `npm audit` currently reports zero known vulnerabilities. Patched transitive `postcss` and `@hono/node-server` versions are pinned with npm overrides to avoid unsafe framework/ORM downgrades suggested by the default audit fixer.
