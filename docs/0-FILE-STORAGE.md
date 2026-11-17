# 0 — File Storage

> Bytes exist for minutes, on one disk, in one directory, with one sweeper. That is the entire storage design.
> Last updated: 16 November 2026

---

## 1. Scope

Lane A stores nothing: its files live in `ImageBitmap` and `Blob` objects owned by the tab. This document
describes lane B only, which needs bytes on disk for exactly as long as a job plus its TTL.

| Data | Location | Lifetime |
|---|---|---|
| uploaded input | `${TEMP_DIR}/{fileId}/original` | `JOB_TTL_MINUTES` after completion, or after upload if no job references it |
| work files | `${TEMP_DIR}/{fileId}/work/` | deleted when the job reaches a terminal state |
| outputs | `${TEMP_DIR}/{fileId}/output/` | `JOB_TTL_MINUTES` after completion |
| ZIP for a multi-output download | streamed, never written | — |

```
${TEMP_DIR}/
└── 0192f3c4-…/              one directory per uploaded file (0700)
    ├── original             (0600)
    ├── work/                (empty after the job)
    └── output/
        └── product-background-removed.png
```

A file's directory is also its job's directory: a server job is one input file plus options in the MVP (batch
fan-out is N jobs, not one job with N files — [12](12-BATCH-PROCESSING.md) §4.2), so a separate job directory would
be a directory with one child.

---

## 2. Why not object storage

| Option | Verdict |
|---|---|
| Local NVMe, per-job directory | **chosen** — one host, `rename` is atomic, deletion is `rm -rf`, no credentials |
| S3/R2 bucket + presigned URLs | rejected for the MVP: adds a second retention policy, a lifecycle rule, credentials, and a class of bug where the bucket outlives the row |
| Shared NFS volume | rejected: `rename` across NFS is not atomic in the way the output write needs |
| Redis as a blob store | rejected: memory-priced, no filesystem semantics, eviction is silent |

The migration path is documented anyway (because "never" is a bad plan): if replication ever needs shared storage,
the seam is `infra/storage/` exposing `put`, `open`, `delete`, `stat`, and the sweeper's `list` — five functions.
Nothing above that layer knows a path.

---

## 3. Writes are atomic

```ts
// infra/storage/write.ts
const tmp = join(dir, `.tmp-${randomUUID()}`);
await writeFile(tmp, buffer, { mode: 0o600 });
await rename(tmp, join(dir, 'output', name));   // same filesystem: atomic
```

Why it matters: the download endpoint can be hit the instant the SSE `done` event fires. A non-atomic write means
a plausible window where the file exists with a partial body and a `Content-Length` from the final size — a
truncated PNG that looks like a corrupt result rather than a race. `rename` removes the window entirely, and the
`.tmp-` prefix lets the sweeper recognise a crash leftover and delete it without touching real output.

Uploads follow the same rule: a streamed body goes to `.tmp-upload` and is renamed after the magic-byte check and
the size check pass. A rejected upload leaves no directory behind.

---

## 4. Permissions and isolation

| Item | Mode | Owner |
|---|---|---|
| `TEMP_DIR` | `0700` | service user |
| per-file dir | `0700` | service user |
| files | `0600` | service user |
| containers | non-root, read-only rootfs, `TEMP_DIR` as the only writable mount | — |

The worker and the API must run as **the same UID** (or in the same group) because the worker writes outputs the
API serves. That is a deliberate trade: separate UIDs would need a shared group with `g+w` on directorate
directories, which is more moving parts for no security gain when both processes handle the same user's bytes.

The container's root filesystem is read-only except for `TEMP_DIR` and `/tmp` (tmpfs, 64 MB). `sharp` and ORT
write temp files to `/tmp`; a small tmpfs turns "unbounded temp growth" into a loud `ENOSPC` in the worker that
fails one job instead of filling the host.

---

## 5. TTL and the sweeper

```text
every SWEEP_INTERVAL_SECONDS (60):
  1. rows where status IN (COMPLETED, FAILED, CANCELLED, EXPIRED) AND expires_at < now()
       → delete directory recursively → status = EXPIRED → expires_at kept
  2. files with no row at all and mtime older than 2 × TTL        (orphan from a crash or a failed insert)
  3. directories matching `.tmp-*` older than 10 minutes          (interrupted write)
  4. rows in a non-terminal state whose worker heartbeat is older than 3 × JOB_TIMEOUT → FAILED, then (1)
  5. if free disk < MIN_FREE_DISK_BYTES: delete oldest EXPIRED-eligible files first, log a warning
```

Details that make it safe:

- **`expires_at` comes from the row, never from `mtime`.** A clock change or a container copy must not extend a
  user's retention, and a restored backup must not look fresh.
- **Deletion is recursive with a path assertion.** The path must start with `TEMP_DIR` after `realpath`; a
  symlink pointing outside is refused and logged, not followed. `rm -rf` on a user-influenced path is how these
  systems lose data, so the assertion is unconditional.
- **The sweeper is single-leader.** With multiple API replicas, the leader is claimed in Redis with a 2×interval
  TTL. Two sweepers are mostly harmless (deletion is idempotent) but they double the `list` cost and can race on
  a row update; the lock is cheap.
- **Sweeping is observable**: `files_swept_total`, `bytes_swept_total`, `sweep_duration_ms`, and
  `oldest_file_age_seconds`. If the last one grows past `2 × TTL`, the sweeper is broken and the alert fires before
  the disk does.
- **A deleted file is gone for good.** No trash, no soft delete, no 7-day recovery. The product promised 15
  minutes; keeping a copy "just in case" would make that promise false.

`POST /api/v1/admin/ops/sweep` runs the same function synchronously for tests and for an operator who sees a
backlog ([0-API](0-API.md) §6).

---

## 6. Download path

```text
GET /jobs/:id/download?index=0
  ├── assertOwned(session, jobId)              404 if not this session
  ├── status must be COMPLETED                 409 VALIDATION_ERROR otherwise
  ├── expires_at > now()                       410 JOB_EXPIRED
  ├── stat output file                         410 if missing (row/file drift → log)
  └── stream with Content-Length, no caching
```

The file is opened **once** and streamed through `Bun.file()`, not read into a buffer: a 25 MB output read into
the request process on every download is a memory amplifier at concurrency. `Content-Length` comes from `stat`,
not from the DB, because the DB value is a report and the file is the fact.

ETag is `"${jobId}-${artifactIndex}-${size}"`, so a resumed download validates correctly and a re-run (new job
id) never matches an old ETag. `Cache-Control: private, no-store` — a cached result on a shared machine would
outlive the TTL the product advertises.

---

## 7. Disk-capacity behaviour

| Free disk | Behaviour |
|---|---|
| > 2 × `MIN_FREE_DISK_BYTES` | normal |
| ≤ `MIN_FREE_DISK_BYTES` | new lane B jobs refused with `503 QUEUE_UNAVAILABLE` and a log warning; lane A unaffected |
| ≤ 2 GB | sweeper deletes EXPIRED-eligible artifacts immediately (ignoring TTL), then refuses if still low |
| ≤ 512 MB | API sets `laneB: "unavailable"`; `/health/ready` goes `degraded` |

Deleting before TTL is the only case where the retention promise is shortened, and it is disclosed in
[0-CONFIG](0-CONFIG.md) as a guard rather than hidden: the alternative is a failed write that corrupts a result,
which is worse for everyone.

---

## 8. Backup and disaster recovery

| Asset | Backed up | Restore |
|---|---|---|
| PostgreSQL | daily + WAL | a restored `jobs` table references outputs that no longer exist → those rows are set `EXPIRED` on first read |
| `TEMP_DIR` | **never** | nothing to restore: user bytes are not backed up by design |
| model files | rebuilt in the image | re-downloaded at build |
| presets / manifest | git | — |

A restored database whose artifacts are gone produces `410 JOB_EXPIRED`, not a 500 — the drift is expected and
handled, because a "file missing on disk" error after a restore is noise, and the sweep would clear the rows
anyway.

---

## 9. What is deferred

| Feature | Needs | Why deferred |
|---|---|---|
| Shareable result link | durable object storage + a token + expiry | contradicts "no artifact storage"; would need its own retention page |
| Job history across sessions | accounts | no accounts in the MVP |
| Resumable upload for 100 MB files | chunked protocol + multipart state | lane B caps at 25 MB; lane A needs no upload |
| Multi-region replication | bucket + CDN | one region until traffic justifies it |

Each entry is a real future feature, and each one is an addition to this document rather than a change to the
retention rule. That is why the rule is written as `expires_at` from the row: a future feature can set a different
`expires_at` without touching the sweeper.

---

## Related docs

- [`0-CONFIG.md`](0-CONFIG.md) §2.3 — the variables behind this document
- [`0-DATABASE.md`](0-DATABASE.md) — the rows the sweeper reads
- [`0-API.md`](0-API.md) §4.5 — the download contract
- [`13-EXPORT-MANAGER.md`](13-EXPORT-MANAGER.md) — ZIP streaming, which never touches this directory
