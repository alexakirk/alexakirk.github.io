(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) root.document.addEventListener("DOMContentLoaded", () => api.initContactForm(root.document, root.fetch));
})(typeof window !== "undefined" ? window : undefined, function () {
  function initContactForm(document, fetchImpl) {
    const form = document.getElementById("contactForm");
    if (!form) return;

    const button = form.querySelector('button[type="submit"]');
    const status = document.getElementById("contactStatus");
    let submitting = false;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;

      submitting = true;
      button.disabled = true;
      button.textContent = "Sending…";
      status.className = "form-status";
      status.textContent = "Sending your message…";

      const fields = new FormData(form);
      const payload = {
        name: fields.get("name"),
        email: fields.get("email"),
        message: fields.get("message"),
        website: fields.get("website"),
      };

      try {
        const response = await fetchImpl("/api/contact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error("Delivery failed");
        form.reset();
        status.className = "form-status success";
        status.textContent = "Thank you! Your message has been sent.";
      } catch {
        status.className = "form-status error";
        status.textContent = "We could not send your message. Please try again later.";
      } finally {
        submitting = false;
        button.disabled = false;
        button.textContent = "Send Message";
      }
    });
  }

  return { initContactForm };
});
