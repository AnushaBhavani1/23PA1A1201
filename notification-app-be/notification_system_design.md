# Notification System Design

---

## Stage 1

### REST API Endpoints

All endpoints require the following header:

```
Authorization: Bearer <token>
Content-Type: application/json
```

---

#### 1. Get All Notifications

```
GET /api/v1/notifications
```

**Query Parameters:**

| Parameter | Type    | Description                              |
|-----------|---------|------------------------------------------|
| type      | string  | Filter: `Placement`, `Result`, `Event`   |
| isRead    | boolean | Filter by read status                    |
| page      | integer | Page number (default: 1)                 |
| limit     | integer | Items per page (default: 10, max: 100)   |

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "d146e95a-ed86-4a34-9e69-3900a14576bc",
        "type": "Placement",
        "message": "CSX Corporation hiring",
        "isRead": false,
        "createdAt": "2026-04-22T17:51:18Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 120,
      "totalPages": 12
    }
  }
}
```

---

#### 2. Get Single Notification

```
GET /api/v1/notifications/:id
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "d146e95a-ed86-4a34-9e69-3900a14576bc",
    "type": "Placement",
    "message": "CSX Corporation hiring",
    "isRead": false,
    "createdAt": "2026-04-22T17:51:18Z"
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": "Notification not found"
}
```

---

#### 3. Mark Notification as Read

```
PATCH /api/v1/notifications/:id/read
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "d146e95a-ed86-4a34-9e69-3900a14576bc",
    "isRead": true,
    "updatedAt": "2026-04-22T18:00:00Z"
  }
}
```

---

#### 4. Mark All Notifications as Read

```
PATCH /api/v1/notifications/read-all
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "All notifications marked as read"
}
```

---

#### 5. Get Unread Notification Count

```
GET /api/v1/notifications/unread-count
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "unreadCount": 14
  }
}
```

---

#### 6. Get Priority Inbox (Top N)

```
GET /api/v1/notifications/priority?limit=10
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "b283218f-ea5a-4b7c-93a9-1f2f240d64b0",
        "type": "Placement",
        "message": "CSX Corporation hiring",
        "isRead": false,
        "priorityScore": 3000000017513518,
        "createdAt": "2026-04-22T17:51:18Z"
      }
    ]
  }
}
```

---

### Real-Time Notifications

**Chosen mechanism: WebSockets (via Socket.IO)**

**Why WebSockets over SSE or Polling:**

| Feature           | Polling     | SSE         | WebSocket      |
|-------------------|-------------|-------------|----------------|
| Bidirectional     | No          | No          | Yes            |
| Real-time latency | High        | Low         | Lowest         |
| Server load       | High        | Medium      | Low            |
| Complexity        | Simple      | Medium      | Medium         |

**WebSocket Events:**

| Event                        | Direction       | Payload                                |
|------------------------------|-----------------|----------------------------------------|
| `connect`                    | Client → Server | `{ studentId }`                        |
| `notification:new`           | Server → Client | Full notification object               |
| `notification:read`          | Client → Server | `{ notificationId }`                   |
| `notification:unread_count`  | Server → Client | `{ count: 5 }`                         |

**Flow:**

1. Student logs in → client connects to WebSocket with `studentId`
2. Server places student in a room: `room:student:<studentId>`
3. When a new notification is created → server emits `notification:new` to the student's room
4. Client displays the notification in real time without a page refresh

---

## Stage 2

### Recommended Database: PostgreSQL

**Why PostgreSQL:**

- Structured notification data maps naturally to relational tables
- Native support for UUIDs, enums, indexes, and full-text search
- JSONB column available for flexible metadata without sacrificing query performance
- pgvector extension available if semantic search on notifications is needed later
- Battle-tested for high-volume transactional workloads

---

### Database Schema

```sql
-- Enum for notification types
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

-- Students table
CREATE TABLE students (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) UNIQUE NOT NULL,
  roll_number  VARCHAR(50) UNIQUE NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       notification_type NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Student-notification mapping (tracks read/unread per student)
CREATE TABLE student_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  is_read         BOOLEAN DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, notification_id)
);
```

---

### SQL Queries (matching Stage 1 APIs)

**Fetch paginated notifications for a student:**

```sql
SELECT n.id, n.type, n.message, sn.is_read, n.created_at
FROM notifications n
JOIN student_notifications sn ON n.id = sn.notification_id
WHERE sn.student_id = $1
ORDER BY n.created_at DESC
LIMIT $2 OFFSET $3;
```

**Mark single notification as read:**

```sql
UPDATE student_notifications
SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND notification_id = $2;
```

**Get unread count:**

```sql
SELECT COUNT(*) AS unread_count
FROM student_notifications
WHERE student_id = $1 AND is_read = FALSE;
```

**Mark all as read:**

```sql
UPDATE student_notifications
SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND is_read = FALSE;
```

---

### Problems at Scale and Solutions

| Problem | Solution |
|---|---|
| Table grows too large (millions of rows) | Partition `notifications` by `created_at` (monthly/quarterly) |
| Slow queries on unread notifications | Add composite indexes on `(student_id, is_read, created_at)` |
| Too many DB connections under load | Use a connection pool (pgBouncer) |
| Read-heavy load (all students fetching on login) | Add a Redis cache layer for unread counts and recent notifications |
| Broadcasting to 50,000 students | Use a message queue (BullMQ / RabbitMQ) instead of synchronous inserts |

---

## Stage 3

### Is the original query accurate?

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

The query is **logically correct** but has issues:

- `SELECT *` fetches all columns including large text fields unnecessarily — select only required columns
- No `LIMIT` clause — fetches all unread notifications even if the UI only shows 10
- Without indexes, PostgreSQL performs a **full sequential scan** across 5,000,000 rows for every request

---

### Why is it slow?

With 50,000 students and 5,000,000 notifications:

- No index on `studentID` → full table scan = O(N)
- No index on `isRead` → every row must be checked after filtering by student
- `ORDER BY createdAt DESC` with no index requires an in-memory sort after filtering
- Result: the DB engine reads millions of rows, sorts them in memory, and returns all of them — even if the UI needs only 10

---

### What to change

**Add a composite index:**

```sql
CREATE INDEX idx_notifications_student_read_time
ON notifications (studentID, isRead, createdAt DESC);
```

**Rewrite the query:**

```sql
SELECT id, type, message, createdAt
FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC
LIMIT 20 OFFSET 0;
```

**Likely cost improvement:**

| Before | After |
|---|---|
| Full table scan: ~5M rows read | Index scan: ~few hundred rows |
| Sort: O(N log N) in memory | Sort already handled by index ordering |
| No pagination: all rows returned | Pagination: only 20 rows returned |

---

### Is indexing every column a good idea?

**No.** It is counterproductive:

- Every index increases **write overhead** — every INSERT/UPDATE/DELETE must update all indexes
- Indexes consume significant **disk space**
- The query planner may choose a **suboptimal index** when too many are present
- Most columns are never used in WHERE clauses — indexing them wastes resources

**Rule of thumb:** Only index columns that appear in `WHERE`, `ORDER BY`, or `JOIN` conditions on large tables, and prefer **composite indexes** aligned to actual query patterns.

---

### Query: Students with Placement notification in last 7 days

```sql
SELECT DISTINCT s.id, s.name, s.email
FROM students s
JOIN student_notifications sn ON s.id = sn.student_id
JOIN notifications n ON n.id = sn.notification_id
WHERE n.type = 'Placement'
  AND n.created_at >= NOW() - INTERVAL '7 days';
```

---

## Stage 4

### Problem

Fetching all notifications fresh from DB on every page load for every student causes:

- High read load on the primary database
- Increased query latency
- Poor user experience during peak traffic (placement season)

---

### Suggested Solutions and Tradeoffs

#### 1. Redis Cache (Primary Recommendation)

Cache the most recent notifications and unread count per student in Redis with a short TTL (e.g., 60 seconds).

```
Key: notifications:student:<studentId>:recent
Value: JSON array of latest 20 notifications
TTL: 60 seconds
```

**Tradeoffs:**

| Pro | Con |
|---|---|
| Dramatically reduces DB reads | Slight staleness (up to TTL seconds) |
| Sub-millisecond response times | Additional infrastructure to maintain |
| Scales horizontally | Cache invalidation logic needed on write |

#### 2. Pagination + Lazy Loading

Instead of loading all notifications on page load, fetch only the first page (10–20 items). Load more on scroll.

**Tradeoffs:**

| Pro | Con |
|---|---|
| Reduces data transferred per request | More complex frontend logic |
| Works without additional infrastructure | Does not reduce DB load if many users load simultaneously |

#### 3. Read Replica

Route all read queries (GET notifications) to a PostgreSQL read replica, keeping the primary DB free for writes.

**Tradeoffs:**

| Pro | Con |
|---|---|
| Scales read capacity linearly | Replication lag (seconds) — replica may be slightly behind |
| No code changes beyond connection routing | Cost of running additional DB instance |

#### 4. HTTP Caching (ETag / Cache-Control)

Use ETags so the browser only re-fetches if the data changed. Server responds `304 Not Modified` otherwise.

**Tradeoffs:**

| Pro | Con |
|---|---|
| Zero server processing on cache hit | Only effective for repeat requests from same client |
| No extra infrastructure | Does not reduce initial load |

---

### Recommended Combined Strategy

1. **Redis** for unread count (changes infrequently, queried on every load)
2. **Pagination** on the notification list (never fetch all at once)
3. **Read replica** once traffic grows beyond a single DB instance

---

## Stage 5

### Shortcomings of the Original Pseudocode

```python
function notify_all(student_ids: array, message: string):
    for student_id in student_ids:
        send_email(student_id, message)   # calls Email API
        save_to_db(student_id, message)   # DB insert
        push_to_app(student_id, message)
```

**Problems:**

1. **Sequential loop** — processing 50,000 students one-by-one is extremely slow; the last student may wait minutes
2. **No error handling** — if `send_email` fails for student 200, the loop crashes and remaining 49,800 students are never notified
3. **No retry logic** — transient failures (network timeout, email API rate limit) cause permanent failures
4. **DB insert per iteration** — 50,000 individual INSERTs are far slower than a single bulk INSERT
5. **Tight coupling** — email sending and DB insert are in the same synchronous call; if the email API is slow, it blocks everything
6. **No atomicity** — a student could receive an email but no in-app notification (or vice versa) if one operation fails mid-way

---

### Should DB save and email send happen together (atomically)?

**No.** They should be decoupled.

- The DB insert (persisting the notification) should happen immediately and reliably
- The email send is a side effect — it can fail, be retried, or be delayed without affecting data integrity
- Coupling them means a slow/failing email API blocks the entire notification pipeline

---

### Redesigned Pseudocode

```python
function notify_all(student_ids: array, message: string):
    # Step 1: Bulk insert all notifications to DB immediately (atomic, fast)
    bulk_insert_notifications(student_ids, message)
    logger.info("Notifications saved to DB", { count: len(student_ids) })

    # Step 2: Enqueue each student as a job in a message queue (BullMQ / RabbitMQ)
    for student_id in student_ids:
        enqueue_job("notification_job_queue", {
            student_id: student_id,
            message: message,
            type: "Placement"
        })

    logger.info("All jobs enqueued", { count: len(student_ids) })


# Worker processes jobs from the queue concurrently
function process_notification_job(job):
    student_id = job.student_id
    message = job.message

    # Send email with retry
    try:
        send_email_with_retry(student_id, message, max_retries=3)
        logger.success("Email sent", { student_id })
    except Exception as e:
        logger.error("Email failed after retries", { student_id, error: e })
        mark_job_failed(job)  # Move to dead-letter queue for manual review

    # Push real-time in-app notification via WebSocket
    try:
        push_to_app(student_id, message)
        logger.success("In-app notification pushed", { student_id })
    except Exception as e:
        logger.warning("In-app push failed", { student_id, error: e })


function send_email_with_retry(student_id, message, max_retries):
    for attempt in range(1, max_retries + 1):
        try:
            send_email(student_id, message)
            return
        except Exception as e:
            logger.warning("Email attempt failed", { attempt, student_id })
            if attempt == max_retries:
                raise e
            sleep(exponential_backoff(attempt))
```

**Key improvements:**

| Improvement | Benefit |
|---|---|
| Bulk DB insert | 50,000 rows in 1 query instead of 50,000 queries |
| Message queue (BullMQ) | Jobs processed concurrently by multiple workers |
| Retry with exponential backoff | Handles transient email API failures gracefully |
| Dead-letter queue | Failed jobs are captured for review, not silently lost |
| Decoupled email and DB | DB integrity not affected by email API issues |

---

## Stage 6

### Approach: Priority Score + Min-Heap

**Priority Score Formula:**

```
priorityScore = typeWeight × 10^12 + timestampMs
```

Where:
- `Placement` → typeWeight = 3
- `Result`    → typeWeight = 2
- `Event`     → typeWeight = 1
- `timestampMs` = Unix timestamp in milliseconds (newer = larger = higher priority)

The large multiplier (`10^12`) ensures that **type always dominates recency** — a newer Event will never outrank an older Placement.

---

### How Top 10 is Maintained Efficiently as New Notifications Arrive

A **Min-Heap of size N (10)** is used:

1. For each new notification, compute its `priorityScore`
2. If the heap has fewer than 10 items → push directly
3. If heap is full and new score > heap minimum → pop the minimum and push the new item
4. Result: the heap always contains the top 10 highest-priority notifications

**Time complexity:** O(log N) per new notification — extremely efficient even for real-time streams of thousands of notifications per second.

**Why not sort the full list every time?**

Sorting all notifications on each new arrival is O(M log M) where M grows unboundedly. The heap approach keeps it O(log N) regardless of total volume.

---

### Output

See `priority_inbox.js` for the full implementation and output screenshots in this folder.