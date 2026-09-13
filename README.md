# alexakirk.com

This repository is a dependency-light static portfolio deployed with Netlify. The HTML remains static, while Netlify's Node function handles contact email at the same-origin `/api/contact` rewrite. The function uses Nodemailer over Zoho SMTP; browser code never receives SMTP credentials.

## Local development and tests

Use Node.js 20 or newer and npm:

```sh
npm install
npm test
npm run check
npx netlify dev
```

Copy `.env.example` to a local `.env` only for local development. `.env` files are ignored. Configure these values as encrypted environment variables in the Netlify site UI for production:

- `SMTP_HOST=smtp.zoho.com`
- `SMTP_PORT=465`
- `SMTP_SECURE=true`
- `SMTP_USER`: the approved, authenticated `lily-kirk.com` Zoho mailbox (also used as `From`)
- `SMTP_PASS`: the mailbox app password/deployment secret
- `NOTIFY_TO=admin@lily-kirk.com` (the function rejects any other configured recipient)

Netlify Functions use a full Node.js runtime and this implementation opens an outbound SMTP connection through Nodemailer. Confirm outbound TCP port 465 remains permitted for the selected Netlify plan/runtime before production cutover; if the platform policy blocks SMTP, replace only the server-side transport with an approved HTTPS transactional-email provider. Do not move provider credentials into the browser.

## Deployment and email DNS

The repository name indicates the site was originally suitable for GitHub Pages, which cannot execute server routes. A working contact endpoint therefore requires deployment to Netlify (using `netlify.toml`) or an equivalent separately hosted API. Netlify is configured here so both the static site and `/api/contact` share one origin; no CORS access is enabled. Point both `alexakirk.com` and `www.alexakirk.com` to the Netlify site using the A/AAAA/CNAME records Netlify specifies, enable HTTPS, and make one hostname canonical.

The `alexakirk.com` domain does **not** need MX records merely to submit this form. Because the authenticated sender is a `lily-kirk.com` Zoho mailbox, that domain's sender authorization and Zoho SPF, DKIM, and DMARC configuration determine deliverability. Mail always uses the authenticated mailbox as `From`, the fixed `admin@lily-kirk.com` recipient, and the validated visitor address as `Reply-To`.

The endpoint limits JSON body and field sizes, validates inputs, quietly traps a honeypot, and applies a per-function-instance IP rate limit of five attempts per ten minutes. For horizontally scaled production traffic, additionally enable Netlify's edge/WAF rate-limiting rule for `POST /api/contact` (five requests per ten minutes per client IP); the in-process limiter is defense in depth but cannot share counters between serverless instances.
