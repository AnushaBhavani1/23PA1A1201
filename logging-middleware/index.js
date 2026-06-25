const log = require("./logger");

async function main() {

    await log(
        "backend",
        "info",
        "handler",
        "Application Started"
    );

    console.log("Program Running...");

    await log(
        "backend",
        "info",
        "service",
        "Processing Request"
    );

    await log(
        "backend",
        "warn",
        "service",
        "Low Memory Warning"
    );

    await log(
        "backend",
        "error",
        "service",
        "Database Connection Failed"
    );

    console.log("Completed");
}

main();