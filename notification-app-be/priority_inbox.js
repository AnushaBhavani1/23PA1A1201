const axios = require("axios");
const logger = require("./logger");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BASE_URL = "http://4.224.186.213/evaluation-service";
const BEARER_TOKEN = process.env.BEARER_TOKEN || "YOUR_BEARER_TOKEN_HERE";

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${BEARER_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

// ─── PRIORITY WEIGHTS ─────────────────────────────────────────────────────────
const PRIORITY_WEIGHT = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

// ─── PRIORITY SCORE CALCULATION ───────────────────────────────────────────────
/**
 * Priority score = typeWeight * 1,000,000 + recencyScore
 *
 * recencyScore: newer notifications get a higher score.
 * We use (maxTimestamp - notificationTimestamp) inverted so that
 * the most recent notification has the highest recencyScore.
 *
 * This ensures:
 *   - Placement always beats Result which always beats Event
 *   - Within same type, newer notification wins
 */
function computePriorityScore(notification, maxTimestampMs) {
  const typeWeight = PRIORITY_WEIGHT[notification.Type] ?? 0;
  const notifTimestampMs = new Date(notification.Timestamp).getTime();
  // Recency: higher for more recent (max possible = maxTimestampMs)
  const recencyScore = notifTimestampMs; // larger = newer = higher priority
  // Scale typeWeight so it always dominates recency differences
  return typeWeight * 1_000_000_000_000 + recencyScore;
}

// ─── MIN-HEAP (for efficiently maintaining Top N) ─────────────────────────────
/**
 * MinHeap keyed on priorityScore.
 * Used to maintain top-N notifications efficiently as new ones arrive.
 * Insertion: O(log N), get top N: O(N log N)
 */
class MinHeap {
  constructor() {
    this.heap = [];
  }

  size() {
    return this.heap.length;
  }

  peek() {
    return this.heap[0];
  }

  push(item) {
    this.heap.push(item);
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].priorityScore <= this.heap[i].priorityScore) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left].priorityScore < this.heap[smallest].priorityScore)
        smallest = left;
      if (right < n && this.heap[right].priorityScore < this.heap[smallest].priorityScore)
        smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

// ─── TOP N NOTIFICATIONS ──────────────────────────────────────────────────────
/**
 * Efficiently finds top N notifications using a Min-Heap of size N.
 * As new notifications stream in, we maintain the heap dynamically.
 *
 * Time: O(M log N) where M = total notifications, N = top count
 */
function getTopNNotifications(notifications, n, maxTimestampMs) {
  const heap = new MinHeap();

  for (const notif of notifications) {
    const priorityScore = computePriorityScore(notif, maxTimestampMs);
    const entry = { ...notif, priorityScore };

    if (heap.size() < n) {
      heap.push(entry);
    } else if (priorityScore > heap.peek().priorityScore) {
      heap.pop();
      heap.push(entry);
    }
  }

  // Extract and sort descending (highest priority first)
  const result = [];
  while (heap.size() > 0) result.push(heap.pop());
  return result.sort((a, b) => b.priorityScore - a.priorityScore);
}

// ─── FETCH NOTIFICATIONS ──────────────────────────────────────────────────────
async function fetchNotifications() {
  logger.info("Fetching notifications from API", { endpoint: "/notifications" });
  try {
    const response = await apiClient.get("/notifications");
    logger.success("Notifications fetched successfully", {
      count: response.data.notifications.length,
    });
    return response.data.notifications;
  } catch (err) {
    logger.error("Failed to fetch notifications", {
      status: err.response?.status,
      message: err.message,
    });
    throw err;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const TOP_N = 10; // configurable: top 10, 15, 20, etc.

  logger.info("=== Notification Priority Inbox Started ===", { topN: TOP_N });

  let notifications;
  try {
    notifications = await fetchNotifications();
  } catch (err) {
    logger.error("Aborting: could not fetch notifications", { error: err.message });
    process.exit(1);
  }

  if (!notifications || notifications.length === 0) {
    logger.warning("No notifications received from API");
    return;
  }

  // Compute max timestamp once (for recency scoring)
  const maxTimestampMs = Math.max(
    ...notifications.map((n) => new Date(n.Timestamp).getTime())
  );

  logger.info("Computing priority scores and selecting top N", {
    totalNotifications: notifications.length,
    topN: TOP_N,
  });

  const topNotifications = getTopNNotifications(notifications, TOP_N, maxTimestampMs);

  logger.success("Top N notifications computed", {
    topN: TOP_N,
    returned: topNotifications.length,
  });

  // ── Display results ──
  console.log(`\n${"=".repeat(70)}`);
  console.log(`   🔔 TOP ${TOP_N} PRIORITY NOTIFICATIONS`);
  console.log(`${"=".repeat(70)}`);
  console.log(
    `${"Rank".padEnd(6)}${"Type".padEnd(12)}${"Timestamp".padEnd(22)}Message`
  );
  console.log(`${"-".repeat(70)}`);

  topNotifications.forEach((notif, index) => {
    const typeLabel = notif.Type.padEnd(12);
    const ts = notif.Timestamp.padEnd(22);
    const rank = `#${index + 1}`.padEnd(6);
    console.log(`${rank}${typeLabel}${ts}${notif.Message}`);
  });

  console.log(`${"=".repeat(70)}\n`);

  // Full JSON output for logging/screenshot
  logger.info("Full top notifications output", {
    topNotifications: topNotifications.map((n, i) => ({
      rank: i + 1,
      id: n.ID,
      type: n.Type,
      message: n.Message,
      timestamp: n.Timestamp,
      priorityScore: n.priorityScore,
    })),
  });

  logger.success("=== Notification Priority Inbox Completed ===");
}

main().catch((err) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  process.exit(1);
});