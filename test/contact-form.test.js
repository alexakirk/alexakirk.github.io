"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { initContactForm } = require("../contact-form");

function fixture(fetchImpl) {
  let listener;
  const button = { disabled: false, textContent: "Send Message" };
  const status = { className: "form-status", textContent: "" };
  const form = {
    values: new Map([["name", "Alexa"], ["email", "a@example.com"], ["message", "Hello"], ["website", ""]]),
    resetCount: 0,
    addEventListener(type, callback) { if (type === "submit") listener = callback; },
    querySelector() { return button; },
    reset() { this.resetCount += 1; },
  };
  const document = { getElementById: (id) => id === "contactForm" ? form : status };
  const OriginalFormData = global.FormData;
  global.FormData = class { constructor(source) { this.values = source.values; } get(key) { return this.values.get(key); } };
  initContactForm(document, fetchImpl);
  return {
    button, status, form,
    submit: () => listener({ preventDefault() {} }),
    restore: () => { global.FormData = OriginalFormData; },
  };
}

test("frontend displays success and resets only after success", async (t) => {
  const ui = fixture(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  t.after(ui.restore);
  await ui.submit();
  assert.equal(ui.form.resetCount, 1);
  assert.match(ui.status.textContent, /message has been sent/i);
  assert.equal(ui.button.disabled, false);
});

test("frontend displays failure and preserves entered values", async (t) => {
  const ui = fixture(async () => ({ ok: false, json: async () => ({ ok: false }) }));
  t.after(ui.restore);
  await ui.submit();
  assert.equal(ui.form.resetCount, 0);
  assert.match(ui.status.textContent, /could not send/i);
  assert.equal(ui.button.textContent, "Send Message");
});

test("frontend prevents duplicate submissions while sending", async (t) => {
  let resolve;
  let calls = 0;
  const ui = fixture(() => {
    calls += 1;
    return new Promise((done) => { resolve = done; });
  });
  t.after(ui.restore);
  const first = ui.submit();
  const second = ui.submit();
  assert.equal(calls, 1);
  assert.equal(ui.button.disabled, true);
  assert.equal(ui.button.textContent, "Sending…");
  resolve({ ok: true, json: async () => ({ ok: true }) });
  await Promise.all([first, second]);
});
