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

// ─── KNAPSACK ALGORITHM (0/1) ─────────────────────────────────────────────────
/**
 * Classic 0/1 Knapsack using dynamic programming.
 * Picks tasks (vehicles) that maximise total Impact within MechanicHours budget.
 *
 * Time complexity : O(n * W)  where n = number of tasks, W = mechanic hours
 * Space complexity: O(n * W)
 */
function knapsack(vehicles, capacity) {
  const n = vehicles.length;

  // dp[i][w] = max impact using first i items with capacity w
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = vehicles[i - 1];
    for (let w = 0; w <= capacity; w++) {
      // Don't take this vehicle
      dp[i][w] = dp[i - 1][w];
      // Take this vehicle if it fits
      if (Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
      }
    }
  }

  // Backtrack to find which vehicles were selected
  const selected = [];
  let w = capacity;
  for (let i = n; i >= 1; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(vehicles[i - 1]);
      w -= vehicles[i - 1].Duration;
    }
  }

  return {
    maxImpact: dp[n][capacity],
    selectedVehicles: selected,
    totalDuration: selected.reduce((sum, v) => sum + v.Duration, 0),
  };
}

// ─── API CALLS ────────────────────────────────────────────────────────────────
async function fetchDepots() {
  logger.info("Fetching depots from API", { endpoint: "/depots" });
  try {
    const response = await apiClient.get("/depots");
    logger.success("Depots fetched successfully", {
      count: response.data.depots.length,
    });
    return response.data.depots;
  } catch (err) {
    logger.error("Failed to fetch depots", {
      status: err.response?.status,
      message: err.message,
    });
    throw err;
  }
}

async function fetchVehicles() {
  logger.info("Fetching vehicles from API", { endpoint: "/vehicles" });
  try {
    const response = await apiClient.get("/vehicles");
    logger.success("Vehicles fetched successfully", {
      count: response.data.vehicles.length,
    });
    return response.data.vehicles;
  } catch (err) {
    logger.error("Failed to fetch vehicles", {
      status: err.response?.status,
      message: err.message,
    });
    throw err;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  logger.info("=== Vehicle Maintenance Scheduler Started ===");

  let depots, vehicles;

  try {
    [depots, vehicles] = await Promise.all([fetchDepots(), fetchVehicles()]);
  } catch (err) {
    logger.error("Aborting: could not fetch required data", { error: err.message });
    process.exit(1);
  }

  logger.info("Starting knapsack optimisation for each depot", {
    totalDepots: depots.length,
    totalVehicles: vehicles.length,
  });

  const results = [];

  for (const depot of depots) {
    logger.info(`Processing Depot ${depot.ID}`, {
      depotId: depot.ID,
      mechanicHours: depot.MechanicHours,
    });

    const { maxImpact, selectedVehicles, totalDuration } = knapsack(
      vehicles,
      depot.MechanicHours
    );

    const result = {
      depotId: depot.ID,
      mechanicHoursBudget: depot.MechanicHours,
      totalDurationUsed: totalDuration,
      remainingHours: depot.MechanicHours - totalDuration,
      totalImpactScore: maxImpact,
      vehiclesSelected: selectedVehicles.length,
      selectedTasks: selectedVehicles.map((v) => ({
        TaskID: v.TaskID,
        Duration: v.Duration,
        Impact: v.Impact,
      })),
    };

    results.push(result);

    logger.success(`Depot ${depot.ID} optimisation complete`, {
      depotId: depot.ID,
      totalImpactScore: maxImpact,
      vehiclesSelected: selectedVehicles.length,
      totalDurationUsed: totalDuration,
      remainingHours: depot.MechanicHours - totalDuration,
    });
  }

  // ── Print final summary ──
  console.log("\n");
  logger.info("=== FINAL RESULTS SUMMARY ===");

  for (const r of results) {
    console.log(`\n--- Depot ${r.depotId} ---`);
    console.log(`  Budget         : ${r.mechanicHoursBudget} hours`);
    console.log(`  Hours Used     : ${r.totalDurationUsed} hours`);
    console.log(`  Hours Remaining: ${r.remainingHours} hours`);
    console.log(`  Max Impact     : ${r.totalImpactScore}`);
    console.log(`  Tasks Selected : ${r.vehiclesSelected}`);
    console.log("  Selected Task IDs:");
    r.selectedTasks.forEach((t) => {
      console.log(`    - ${t.TaskID}  (Duration: ${t.Duration}h, Impact: ${t.Impact})`);
    });
  }

  logger.success("=== Vehicle Maintenance Scheduler Completed ===", {
    depotsProcessed: results.length,
  });

  return results;
}

main().catch((err) => {
  logger.error("Unhandled error in main", { error: err.message, stack: err.stack });
  process.exit(1);
});