const { getSessionStatus } = require("../src/search");

async function main() {
  const status = await getSessionStatus();
  console.log(JSON.stringify(status, null, 2));
  process.exit(status.status === "ready" ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
