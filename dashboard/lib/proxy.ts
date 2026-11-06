const routes =
  /^(health|api\/v1\/(slots|collector|builders|alerts|live)|api\/v1\/payloadwatch\/slots\/\d+(\/timeline)?|api\/v1\/frames\/(transactions(\/0x[0-9a-fA-F]{64}(\/evidence)?)?|node|incidents|submissions|conformance)|api\/v1\/xray\/(blocks(\/0x[0-9a-fA-F]{64})?|summary)|api\/v1\/profiles(\/0x[0-9a-fA-F]{64}(\/capture)?)?|api\/v1\/providers\/comparisons(\/0x[0-9a-fA-F]{64})?|api\/v1\/cre\/(reports|policies)|api\/v1\/incidents\/summaries\/0x[0-9a-fA-F]{64}|api\/v1\/analysis\/(runs(\/0x[0-9a-fA-F]{64}(\/(bal|dependencies|uniswap|evidence))?)?|blocks\/0x[0-9a-fA-F]{64}))$/;
export function backendURL(path: string[], search: string, base: string) {
  const joined = path.join("/");
  if (!routes.test(joined)) throw new Error("Unsupported backend route");
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Backend URL must be an HTTP origin without credentials");
  return new URL("/" + joined + search, url);
}
