import { randomUUID } from "node:crypto";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";

export class MarketStoreError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "invalid_state" | "insufficient_funds",
    message: string,
  ) {
    super(message);
    this.name = "MarketStoreError";
  }
}

export function createMarketStore(database: ReturnType<typeof createDatabase>) {
  async function listActive() {
    const rows = await database.client`
      SELECT listing_id, seller_id, item_instance_id, title, description,
             price_cents, status, created_at
      FROM game.marketplace_listings
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return rows.map((r) => ({
      listingId: String(r.listing_id),
      sellerId: String(r.seller_id),
      itemInstanceId: r.item_instance_id ? String(r.item_instance_id) : null,
      title: String(r.title),
      description: String(r.description),
      priceCents: Number(r.price_cents),
      status: String(r.status),
      createdAt: new Date(r.created_at as Date).toISOString(),
    }));
  }

  async function createListing(input: {
    sellerId: string;
    title: string;
    description?: string;
    priceCents: number;
    itemInstanceId?: string;
  }) {
    if (input.priceCents < 0) throw new MarketStoreError("invalid_state", "Price must be >= 0");
    const id = randomUUID();

    // ponytail: mint a goods instance when seller didn't attach one so buy transfers inventory
    let itemId = input.itemInstanceId || null;
    if (!itemId) {
      itemId = randomUUID();
      const defId = `goods:${id.slice(0, 8)}`;
      await database.client`
        INSERT INTO game.entity_definitions (
          definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
        ) VALUES (
          ${defId}, 'item', ${input.title}, ${input.description || input.title}, 'market', 'approved'
        ) ON CONFLICT (definition_id) DO NOTHING
      `;
      await database.client`
        INSERT INTO game.entity_instances (instance_id, definition_id, location_id, owner_id, state)
        VALUES (
          ${itemId}, ${defId}, NULL, ${input.sellerId},
          ${json({ name: input.title, marketListing: true, priceCents: input.priceCents })}
        )
      `;
    }

    await database.client`
      INSERT INTO game.marketplace_listings (
        listing_id, seller_id, item_instance_id, title, description, price_cents
      ) VALUES (
        ${id}, ${input.sellerId}, ${itemId},
        ${input.title}, ${input.description || ""}, ${input.priceCents}
      )
    `;
    return { listingId: id, itemInstanceId: itemId };
  }

  async function buy(input: { buyerId: string; listingId: string }) {
    return database.client.begin(async (sql) => {
      const rows = await sql`
        SELECT * FROM game.marketplace_listings
        WHERE listing_id = ${input.listingId} AND status = 'active'
        FOR UPDATE
      `;
      const listing = rows[0];
      if (!listing) throw new MarketStoreError("not_found", "Listing not available.");
      if (String(listing.seller_id) === input.buyerId) {
        throw new MarketStoreError("invalid_state", "Cannot buy your own listing.");
      }

      // Cash from actor state.cashOnPerson (cents)
      const buyerRows = await sql`
        SELECT state FROM game.entity_instances WHERE instance_id = ${input.buyerId} FOR UPDATE
      `;
      if (!buyerRows[0]) throw new MarketStoreError("not_found", "Buyer not found.");
      const buyerState = { ...((buyerRows[0].state as Record<string, unknown>) || {}) };
      const cash = Number(buyerState.cashOnPerson ?? 0);
      const price = Number(listing.price_cents);
      if (cash < price) {
        throw new MarketStoreError("insufficient_funds", `Need ${price} cents, have ${cash}.`);
      }
      buyerState.cashOnPerson = cash - price;

      let itemInstanceId = listing.item_instance_id ? String(listing.item_instance_id) : null;
      if (itemInstanceId) {
        await sql`
          UPDATE game.entity_instances
          SET owner_id = ${input.buyerId}, updated_at = now()
          WHERE instance_id = ${itemInstanceId}
        `;
      }

      // mirror into state.inventory for UI/audit (name + id)
      const inv = Array.isArray(buyerState.inventory)
        ? [...(buyerState.inventory as unknown[])]
        : [];
      inv.push({
        instanceId: itemInstanceId,
        title: String(listing.title),
        acquiredAt: new Date().toISOString(),
        via: "market",
      });
      buyerState.inventory = inv;

      await sql`
        UPDATE game.entity_instances SET state = ${json(buyerState)}, updated_at = now()
        WHERE instance_id = ${input.buyerId}
      `;

      const sellerRows = await sql`
        SELECT state FROM game.entity_instances WHERE instance_id = ${listing.seller_id} FOR UPDATE
      `;
      if (sellerRows[0]) {
        const sellerState = { ...((sellerRows[0].state as Record<string, unknown>) || {}) };
        sellerState.cashOnPerson = Number(sellerState.cashOnPerson ?? 0) + price;
        await sql`
          UPDATE game.entity_instances SET state = ${json(sellerState)}, updated_at = now()
          WHERE instance_id = ${listing.seller_id}
        `;
      }

      await sql`
        UPDATE game.marketplace_listings
        SET status = 'sold', buyer_id = ${input.buyerId}, sold_at = now()
        WHERE listing_id = ${input.listingId}
      `;

      return {
        listingId: input.listingId,
        buyerId: input.buyerId,
        priceCents: price,
        itemInstanceId,
        inventoryCount: inv.length,
      };
    });
  }

  async function cancel(input: { sellerId: string; listingId: string }) {
    const rows = await database.client`
      UPDATE game.marketplace_listings
      SET status = 'cancelled'
      WHERE listing_id = ${input.listingId}
        AND seller_id = ${input.sellerId}
        AND status = 'active'
      RETURNING listing_id
    `;
    if (!rows[0]) throw new MarketStoreError("not_found", "Listing not found or not yours.");
    return { listingId: input.listingId, status: "cancelled" };
  }

  return { listActive, createListing, buy, cancel };
}

export type MarketStore = ReturnType<typeof createMarketStore>;
