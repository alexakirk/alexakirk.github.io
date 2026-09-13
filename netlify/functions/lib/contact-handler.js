"use strict";

const EXPECTED_RECIPIENT = "admin@lily-kirk.com";
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function clientAddress(event) {
  return (
    event.headers?.["x-nf-client-connection-ip"] ||
    event.headers?.["X-Nf-Client-Connection-Ip"] ||
    event.requestContext?.identity?.sourceIp ||
    "unknown"
  );
}

function createRateLimiter({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS, now = Date.now } = {}) {
  const attempts = new Map();

  return (key) => {
    const timestamp = now();
    const active = (attempts.get(key) || []).filter((time) => timestamp - time < windowMs);
    active.push(timestamp);
    attempts.set(key, active);

    if (attempts.size > 1_000) {
      for (const [storedKey, times] of attempts) {
        if (!times.some((time) => timestamp - time < windowMs)) attempts.delete(storedKey);
      }
    }

    return active.length <= limit;
  };
}

function validate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (typeof payload.website === "string" && payload.website.trim()) return { spam: true };

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";

  if (
    !name ||
    name.length > 100 ||
    /[\r\n]/.test(name) ||
    !email ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    /[\r\n]/.test(email) ||
    !message ||
    message.length > 5_000
  ) {
    return null;
  }

  return { name, email, message };
}

function mailSettings(env) {
  const port = Number(env.SMTP_PORT);
  const secure = env.SMTP_SECURE === "true";
  if (
    !env.SMTP_HOST ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !["true", "false"].includes(env.SMTP_SECURE) ||
    !env.SMTP_USER ||
    !env.SMTP_PASS ||
    env.NOTIFY_TO !== EXPECTED_RECIPIENT
  ) {
    throw new Error("Contact email configuration is invalid");
  }

  return {
    transport: {
      host: env.SMTP_HOST,
      port,
      secure,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    },
    from: env.SMTP_USER,
  };
}

function createHandler({ env = process.env, transporter, rateLimiter = createRateLimiter(), logger = console } = {}) {
  return async (event) => {
    if (event.httpMethod !== "POST") {
      return { ...json(405, { ok: false, error: "Method not allowed." }), headers: { ...json(405, {}).headers, allow: "POST" } };
    }

    const contentType = event.headers?.["content-type"] || event.headers?.["Content-Type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json(415, { ok: false, error: "Content-Type must be application/json." });
    }

    if (typeof event.body !== "string" || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
      return json(400, { ok: false, error: "Invalid submission." });
    }

    if (!rateLimiter(clientAddress(event))) {
      return json(429, { ok: false, error: "Too many requests. Please try again later." });
    }

    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return json(400, { ok: false, error: "Invalid submission." });
    }

    const submission = validate(payload);
    if (submission?.spam) return json(200, { ok: true });
    if (!submission) return json(400, { ok: false, error: "Please check the submitted fields." });

    try {
      const settings = mailSettings(env);
      // Load the production transport only when it is needed so tests can inject a mock.
      const mailer = transporter || require("nodemailer").createTransport(settings.transport);
      await mailer.sendMail({
        from: settings.from,
        to: EXPECTED_RECIPIENT,
        replyTo: submission.email,
        subject: `New alexakirk.com contact submission from ${submission.name}`,
        text: `Name: ${submission.name}\nEmail: ${submission.email}\n\nMessage:\n${submission.message}`,
      });
      return json(200, { ok: true });
    } catch (error) {
      logger.error("Contact email delivery failed", { name: error?.name || "Error" });
      return json(502, { ok: false, error: "We could not send your message. Please try again later." });
    }
  };
}

module.exports = { EXPECTED_RECIPIENT, MAX_BODY_BYTES, createHandler, createRateLimiter, validate };
