async function sendDiscordWebhook(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed with ${response.status}${text ? `: ${text}` : ""}`);
  }
}

module.exports = {
  sendDiscordWebhook
};
