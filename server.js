/**
 * Backend API for Stripe Payment Processing
 *
 * This is a simple example using Express.js
 * Install with: npm install express body-parser stripe cors
 *
 * Run with: node server.js
 */

import express from "express";
import bodyParser from "body-parser";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(bodyParser.json());

/**
 * Products endpoint
 * GET /api/products
 * Returns products queried from Stripe (includes a price lookup)
 */
app.get("/api/products", async (req, res) => {
  try {
    // List products from Stripe
    const stripeProducts = await stripe.products.list({ limit: 100 });

    const results = await Promise.all(
      stripeProducts.data.map(async (p) => {
        // Try to obtain a price for the product
        let displayPrice = null;
        let maxPrice = null;
        let priceObj = null;
        let variable = false;

        console.log(p);

        try {
          if (p.default_price) {
            // default_price can be an id or an object
            if (typeof p.default_price === "string") {
              priceObj = await stripe.prices.retrieve(p.default_price);

              console.log(priceObj);
              if (priceObj) {
                if (typeof priceObj.unit_amount === "number") {
                  displayPrice = priceObj.unit_amount / 100.0;
                }

                if (priceObj.custom_unit_amount) {
                  variable = true;
                  if (priceObj.custom_unit_amount.maximum) {
                    maxPrice = priceObj.custom_unit_amount.maximum / 100;
                  }
                }
              }
            } else {
              priceObj = p.default_price;
            }
          }
        } catch (err) {
          console.error(
            "Error fetching price for product",
            p.id,
            err.message || err,
          );
        }

        return {
          id: p.id,
          name: p.name,
          unit_amount: priceObj.unit_amount,
          custom_unit_amount: priceObj.custom_unit_amount,
          description: p.description || "",
          price: displayPrice,
          maxPrice: maxPrice,
          variable: variable,
          price_id: p.default_price,
          image: (p.images && p.images[0]) || null,
        };
      }),
    );

    res.json(results);
  } catch (error) {
    console.error(
      "Error fetching products from Stripe:",
      error.message || error,
    );
    res.status(500).json({ error: "Failed to fetch products from Stripe" });
  }
});

/**
 * Purchases lookup by email
 * GET /api/purchases?email=you@example.com
 * Returns payment intents associated with customers that match the email
 */
app.get("/api/purchases", async (req, res) => {
  const email = req.query.email;
  if (!email)
    return res.status(400).json({ error: "email query parameter required" });

  try {
    // Find customers with this email
    const customers = await stripe.customers.list({ email, limit: 10 });

    console.log(email, customers);

    const allIntents = [];

    for (const c of customers.data) {
      // List payment intents for the customer
      const intents = await stripe.paymentIntents.list({
        customer: c.id,
        limit: 100,
      });
      for (const intent of intents.data) {
        // Extract items from metadata if available
        let items = [];
        try {
          if (intent.metadata && intent.metadata.items) {
            items = JSON.parse(intent.metadata.items);
          }
        } catch (err) {
          // ignore parse errors
        }

        allIntents.push({
          paymentIntentId: intent.id,
          amount: intent.amount, // in cents
          currency: intent.currency,
          status: intent.status,
          created: intent.created,
          receipt_email: intent.receipt_email || c.email || email,
          customer: { id: c.id, name: c.name || null, email: c.email || null },
          items,
        });
      }
    }

    // Sort desc by created timestamp
    allIntents.sort((a, b) => (b.created || 0) - (a.created || 0));

    res.json(allIntents);
  } catch (err) {
    console.error("Error looking up purchases:", err.message || err);
    res.status(500).json({ error: "Failed to lookup purchases" });
  }
});

/**
 * Create Payment Intent
 * POST /api/create-payment-intent
 *
 * Body:
 * {
 *   amount: number (in cents),
 *   items: array of items
 * }
 */
app.post("/api/create-payment-intent", async (req, res) => {
  try {
    const { amount, items, receipt_email } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!receipt_email) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const customer = await stripe.customers.create({
      email: receipt_email,
    });

    const description = `Wedding gift purchase - ${items
      .map((i) => i.name)
      .join(", ")}`;

    const paymentParams = {
      amount: amount,
      receipt_email: receipt_email,
      currency: "gbp",
      customer: customer.id,
      description: description,
      metadata: {
        items: JSON.stringify(items),
      },
    };

    // Create a payment intent
    const paymentIntent = await stripe.paymentIntents.create(paymentParams);

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/create-invoice-item", async (req, res) => {
  try {
    const { amount, items, receipt_email } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!receipt_email) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const customer = await stripe.customers.create({
      email: receipt_email,
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "charge_automatically",
    });

    items.forEach(async (item) => {
      console.log(item);

      const priceopts = {
        invoice: invoice.id,
        customer: customer.id,
      };
      if (item.variable) {
        priceopts.amount = item.price * 100; // to be in cents;
      } else {
        priceopts.pricing = { price: item.price_id };
      }

      const invoiceline = await stripe.invoiceItems.create(priceopts);
    });

    const description = `${items.map((i) => i.name).join(", ")}`;
    const finalise_invoice = await stripe.invoices.finalizeInvoice(invoice.id);
    const paymentIntent = await stripe.paymentIntents.create({
      currency: invoice.currency,
      customer: customer.id,
      amount: finalise_invoice.amount_due,
      receipt_email: finalise_invoice.customer_email,
      description: description,
    });
    // const attached_invoice = await stripe.invoices.attachPayment(invoice.id, {
    //   payment_intent: paymentIntent.id,
    //   expand: ["payments"],
    // });

    // console.log(finalise_invoice);

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Webhook for Stripe events
 * POST /api/webhook
 */
app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );

      // Handle payment intent succeeded
      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object;
        console.log("Payment succeeded:", paymentIntent.id);

        // TODO: Update your database to mark the order as paid
        // Send confirmation email
        // Update inventory
      }

      // Handle payment intent failed
      if (event.type === "payment_intent.payment_failed") {
        const paymentIntent = event.data.object;
        console.log("Payment failed:", paymentIntent.id);

        // TODO: Handle failed payment
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(400).json({ error: error.message });
    }
  },
);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Stripe payment server running on port ${PORT}`);
  console.log(
    "Make sure to set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET environment variables",
  );
});
