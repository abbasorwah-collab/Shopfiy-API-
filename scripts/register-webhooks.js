// Registers the Shopify webhooks that drive live inventory updates.
// Usage: PUBLIC_URL=https://your-public-host npm run register-webhooks
import { shopifyGraphQL } from "../src/shopify.js";

const base = process.env.PUBLIC_URL;
if (!base || !base.startsWith("https://")) {
  console.error("Set PUBLIC_URL to the public https:// address of this service");
  process.exit(1);
}

const topics = ["INVENTORY_LEVELS_UPDATE", "PRODUCTS_UPDATE", "ORDERS_CREATE"];

for (const topic of topics) {
  const data = await shopifyGraphQL(
    `mutation Reg($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`,
    { topic, sub: { callbackUrl: `${base}/webhooks/shopify`, format: "JSON" } }
  );
  const errs = data.webhookSubscriptionCreate.userErrors;
  console.log(topic, errs.length ? `-> ${errs.map((e) => e.message).join("; ")}` : "-> registered");
}
