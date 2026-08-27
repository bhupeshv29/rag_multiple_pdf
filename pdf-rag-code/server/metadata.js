const CLIENT_PATTERNS = [
  { client: "robert", pattern: /robert/i },
  { client: "nathan", pattern: /nathan/i },
];

export function inferMetadata(filename) {
  const name = String(filename ?? "");

  const clientMatch = CLIENT_PATTERNS.find(({ pattern }) => pattern.test(name));

  const client = clientMatch?.client ?? "unknown";

  const docType =
    /transcript/i.test(name) || client !== "unknown"
      ? "transcript"
      : "document";

  return {
    source: name,
    client,
    docType,
  };
}
