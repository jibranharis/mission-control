// One-time helper: prints a Google refresh token for GOOGLE_REFRESH_TOKEN.
// Usage: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google-auth
import http from "node:http";

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

const port = 53682;
const redirectUri = `http://127.0.0.1:${port}`;
const scopes = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: scopes.join(" "),
  access_type: "offline",
  prompt: "consent",
}).toString();

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirectUri).searchParams.get("code");
  if (!code) {
    res.end("No code in the redirect.");
    return;
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await tokenRes.json();
  res.end(body.refresh_token ? "Done. You can close this tab." : "Something went wrong; check the terminal.");
  if (body.refresh_token) console.log(`\nGOOGLE_REFRESH_TOKEN=${body.refresh_token}\n`);
  else console.error(body);
  server.close();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Open this URL and sign in with the Google account to show:\n\n${authUrl}\n`);
});
