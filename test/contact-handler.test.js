"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXPECTED_RECIPIENT,
  MAX_BODY_BYTES,
  createHandler,
  createRateLimiter,
} = require("../netlify/functions/lib/contact-handler");

const env = {
  SMTP_HOST: "smtp.zoho.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "sender@lily-kirk.com",
  SMTP_PASS: "test-only-password",
  NOTIFY_TO: EXPECTED_RECIPIENT,
};

function request(payload, ip = "203.0.113.1") {
  return {
    httpMethod: "POST",
    headers: { "content-type": "application/json", "x-nf-client-connection-ip": ip },
    body: JSON.stringify(payload),
  };
}

function setup(options = {}) {
  const sent = [];
  const transporter = options.transporter || { sendMail: async (mail) => sent.push(mail) };
  const handler = createHandler({
    env,
    transporter,
    rateLimiter: options.rateLimiter || (() => true),
    logger: { error() {} },
  });
  return { handler, sent };
}

test("valid submission sends server-controlled mail and returns success", async () => {
  const { handler, sent } = setup();
  const response = await handler(request({
    name: "  Alexa  ",
    email: "VISITOR@example.com ",
    message: " Hello! ",
    from: "attacker@example.com",
    to: "attacker@example.com",
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, env.SMTP_USER);
  assert.equal(sent[0].to, "admin@lily-kirk.com");
  assert.equal(sent[0].replyTo, "visitor@example.com");
  assert.match(sent[0].subject, /from Alexa$/);
  assert.match(sent[0].text, /Name: Alexa\nEmail: visitor@example.com/);
});

test("missing fields return 400 without sending", async () => {
  const { handler, sent } = setup();
  const response = await handler(request({ name: "Alexa", email: "a@example.com" }));
  assert.equal(response.statusCode, 400);
  assert.equal(sent.length, 0);
});

test("invalid email returns 400", async () => {
  const { handler } = setup();
  assert.equal((await handler(request({ name: "A", email: "invalid", message: "Hi" }))).statusCode, 400);
});

test("oversized fields and request bodies are rejected", async () => {
  const { handler } = setup();
  assert.equal((await handler(request({ name: "A".repeat(101), email: "a@example.com", message: "Hi" }))).statusCode, 400);
  assert.equal((await handler(request({ name: "A", email: "a@example.com", message: "x".repeat(5_001) }))).statusCode, 400);
  const oversized = request({ name: "A", email: "a@example.com", message: "x" });
  oversized.body = "x".repeat(MAX_BODY_BYTES + 1);
  assert.equal((await handler(oversized)).statusCode, 400);
});

test("a filled honeypot quietly succeeds without sending", async () => {
  const { handler, sent } = setup();
  const response = await handler(request({ name: "Bot", email: "bot@example.com", message: "Spam", website: "https://spam.test" }));
  assert.equal(response.statusCode, 200);
  assert.equal(sent.length, 0);
});

test("rate limiting is enforced", async () => {
  let now = 1_000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
  const { handler, sent } = setup({ rateLimiter: limiter });
  const payload = { name: "A", email: "a@example.com", message: "Hi" };
  assert.equal((await handler(request(payload))).statusCode, 200);
  assert.equal((await handler(request(payload))).statusCode, 200);
  assert.equal((await handler(request(payload))).statusCode, 429);
  assert.equal(sent.length, 2);
  now += 60_001;
  assert.equal((await handler(request(payload))).statusCode, 200);
});

test("provider failure returns a safe generic response", async () => {
  const transporter = { sendMail: async () => { throw new Error("secret SMTP response"); } };
  const { handler } = setup({ transporter });
  const response = await handler(request({ name: "A", email: "a@example.com", message: "Hi" }));
  assert.equal(response.statusCode, 502);
  assert.doesNotMatch(response.body, /secret|SMTP/i);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    error: "We could not send your message. Please try again later.",
  });
});

test("recipient configuration cannot be redirected", async () => {
  const handler = createHandler({
    env: { ...env, NOTIFY_TO: "attacker@example.com" },
    transporter: { sendMail: async () => assert.fail("must not send") },
    rateLimiter: () => true,
    logger: { error() {} },
  });
  assert.equal((await handler(request({ name: "A", email: "a@example.com", message: "Hi" }))).statusCode, 502);
});
