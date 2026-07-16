// Identity from a trusted SSO proxy header (Cloudflare Access / oauth2-proxy).
// The app must only be reachable through the proxy — see DEPLOY.md.
const HEADER = (process.env.AUTH_EMAIL_HEADER || 'cf-access-authenticated-user-email').toLowerCase();
const DEV_USER = process.env.DEV_USER || null;

export function authMiddleware(req, res, next) {
  const email = req.headers[HEADER] || DEV_USER;
  if (!email) {
    return res.status(401).json({
      error: 'No identity. Access this app through the company SSO proxy (or set DEV_USER for local development).',
    });
  }
  req.userEmail = String(email).toLowerCase();
  next();
}
