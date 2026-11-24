export function validateProviderEndpoint(value: string, providerName = "Provider") {
  const url = new URL(value);
  if (url.username || url.password) return `${providerName} endpoints cannot contain credentials.`;

  const allowedHosts = configuredHosts();
  if (allowedHosts && !allowedHosts.has(url.hostname.toLowerCase())) {
    return `This ${providerName} host is not in ALLOWED_OLLAMA_HOSTS.`;
  }

  if (!allowedHosts && !isTrustedLocalHost(url.hostname) && !(providerName === "telemetry" && url.hostname.toLowerCase() === "telemetry")) {
    return `Use a local/private ${providerName} host or configure ALLOWED_OLLAMA_HOSTS explicitly.`;
  }

  return null;
}

export function validateOllamaEndpoint(value: string) {
  return validateProviderEndpoint(value, "Ollama");
}

export function validateEvaluatorEndpoint(value: string) {
  const url = new URL(value);
  if (url.username || url.password) return "Evaluator endpoints cannot contain credentials.";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && isTrustedLocalHost(url.hostname)) return null;
  return "Evaluator endpoints must use HTTPS unless they are local.";
}

function configuredHosts() {
  const raw = process.env.ALLOWED_OLLAMA_HOSTS?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function isTrustedLocalHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}
