// If APP_PASSWORD is set, every API call must send it in the x-app-password header.
export function checkPassword(request) {
  const required = process.env.APP_PASSWORD;
  if (!required) return null;
  if (request.headers.get("x-app-password") === required) return null;
  return Response.json({ error: "Wrong or missing password." }, { status: 401 });
}
