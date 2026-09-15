export function shouldLoadRemoteDesktopUi(env = process.env) {
  return env.FARMOPS_DESKTOP_ALLOW_REMOTE_UI === "true" && Boolean(env.FARMOPS_DESKTOP_URL);
}
