import { CodexApiError } from "../codex/validation.mjs";

const ALLOWED_HOST_SUFFIXES = [".xhscdn.com", ".xiaohongshu.com"];
const IMAGE_ROUTE = "/api/xhs/image";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function isAllowedHost(hostname) {
  const normalized = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => normalized.endsWith(suffix) && normalized.length > suffix.length,
  );
}

function toProxyUrl(imageUrl) {
  if (!imageUrl) return "";
  try {
    const target = new URL(imageUrl);
    if (target.protocol !== "https:" && target.protocol !== "http:") return "";
    if (!isAllowedHost(target.hostname)) return "";
    return `${IMAGE_ROUTE}?url=${encodeURIComponent(imageUrl)}`;
  } catch {
    return "";
  }
}

export function proxifyXhsImage(imageUrl) {
  return toProxyUrl(imageUrl) || imageUrl || "";
}

async function fetchImage(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        Referer: "https://www.xiaohongshu.com/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

export async function serveXhsImage(requestUrl, res, next) {
  if (requestUrl.pathname !== IMAGE_ROUTE) {
    return false;
  }

  const rawUrl = requestUrl.searchParams.get("url");
  if (!rawUrl) {
    sendText(res, 400, "Missing url parameter.");
    return true;
  }

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    sendText(res, 400, "Invalid url parameter.");
    return true;
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    sendText(res, 400, "Only http(s) urls are supported.");
    return true;
  }

  if (!isAllowedHost(target.hostname)) {
    sendText(res, 403, "Host not allowed.");
    return true;
  }

  try {
    const response = await fetchImage(target.toString());

    if (!response.ok) {
      sendText(res, response.status, `Upstream responded ${response.status}.`);
      return true;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const contentLength = response.headers.get("content-length");

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    let received = 0;
    const reader = response.body?.getReader();
    if (!reader) {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
      return true;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > MAX_IMAGE_BYTES) {
          reader.cancel().catch(() => {});
          return true;
        }
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (error) {
    if (error?.name === "AbortError") {
      sendText(res, 504, "Image fetch timed out.");
      return true;
    }
    sendText(res, 502, "Image fetch failed.");
  }

  return true;
}
