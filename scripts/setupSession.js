const { openSessionBrowser } = require("../src/search");

async function main() {
  const context = await openSessionBrowser();
  console.log("Browser opened with the shared Amazon session directory.");
  console.log("Log in to Amazon, set delivery to Israel, and verify that free-shipping results look correct.");
  console.log("Press Ctrl+C after you finish. The session will stay on disk for the server to reuse.");

  const closeContext = async () => {
    await context.close().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void closeContext();
  });
  process.on("SIGTERM", () => {
    void closeContext();
  });

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
