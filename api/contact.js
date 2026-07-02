// Vercel serverless function — Parsi & Company form handler.
// Mirrors the MeridIAn approach: send the lead as an email via the Resend
// HTTPS API. No Formspree, so no monthly submission cap.
// Handles both the consultation form and the newsletter form (any fields).

const TO = process.env.CONTACT_TO || "info@parsicocpa.com";
// FROM must be a domain verified in Resend. Until parsicocpa.com is verified,
// the Resend test sender "onboarding@resend.dev" works.
const FROM = process.env.CONTACT_FROM || "Parsi Web <onboarding@resend.dev>";

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Human labels for known fields; anything else falls back to its raw key.
const LABELS = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  service: "Service",
  entity: "Entity type",
  message: "Message",
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let data = req.body;
  // Vercel parses JSON bodies automatically, but guard against a string body.
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  data = data || {};

  const name = String(data.name || "").trim();
  const email = String(data.email || "").trim();
  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(422).json({ error: "Missing required fields (name and a valid email)." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY not configured");
    return res.status(500).json({ error: "Email not configured on the server." });
  }

  const subject = String(data._subject || `New form submission from ${name}`);

  // Render every provided field (except control fields) into the email.
  const skip = new Set(["_subject", "_gotcha"]);
  const rows = Object.keys(data)
    .filter((k) => !skip.has(k) && String(data[k] == null ? "" : data[k]).trim() !== "")
    .map((k) => [LABELS[k] || k, data[k]]);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#1b1b1b">
      <h2 style="color:#0a2730">${esc(subject)}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:8px 10px;background:#f3f0ea;font-weight:bold;width:170px;vertical-align:top">${esc(k)}</td><td style="padding:8px 10px;border-bottom:1px solid #eee">${esc(v).replace(/\n/g, "<br>")}</td></tr>`
          )
          .join("")}
      </table>
    </div>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email,
        subject,
        html,
        text,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Resend error:", r.status, detail);
      return res.status(502).json({ error: "Could not send the email." });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Resend fetch failed:", err);
    return res.status(502).json({ error: "Network error while sending." });
  }
};
