import type { DeterministicGrader } from "@/lib/contracts";

export const PRACTICAL_SLM_SUITE_KEY = "practical-slm";
export const PRACTICAL_SLM_SUITE_VERSION = "1.0.0";
export const PRACTICAL_SLM_SEED_NAMESPACE = "tuxevil-benchmark:practical-slm:v1";

export type PracticalSlmScenarioDefinition = {
  key: string;
  name: string;
  systemPrompt: string;
  userMessages: string[];
  grader: DeterministicGrader;
};

export const PRACTICAL_SLM_SCENARIOS: PracticalSlmScenarioDefinition[] = [
  {
    key: "classification-sentiment",
    name: "Practical SLM · Classification · Sentiment",
    systemPrompt: "Classify the user's sentence. Return exactly one uppercase label and nothing else: POSITIVE, NEGATIVE, or NEUTRAL.",
    userMessages: ["The setup was painless and the service has been reliable for months."],
    grader: { type: "EXACT_TEXT", version: 1, expected: "POSITIVE", caseSensitive: true, collapseWhitespace: false },
  },
  {
    key: "classification-priority",
    name: "Practical SLM · Classification · Incident priority",
    systemPrompt: "Assign exactly one incident priority label and output only that label: P1, P2, P3, or P4. P1 means a production-wide outage affecting all customers.",
    userMessages: ["All customers receive HTTP 503 from the production API. No requests are succeeding."],
    grader: { type: "EXACT_TEXT", version: 1, expected: "P1", caseSensitive: true, collapseWhitespace: false },
  },
  {
    key: "classification-routing",
    name: "Practical SLM · Classification · Support routing",
    systemPrompt: "Route the request. Output exactly one label: BILLING, TECHNICAL, SALES, or OTHER.",
    userMessages: ["I was charged twice for invoice 4812 and need one charge refunded."],
    grader: { type: "EXACT_TEXT", version: 1, expected: "BILLING", caseSensitive: true, collapseWhitespace: false },
  },
  {
    key: "json-contact-extraction",
    name: "Practical SLM · JSON · Contact extraction",
    systemPrompt: "Extract the requested fields. Return only valid JSON with exactly the keys name, email, and company. Do not add markdown.",
    userMessages: ["Hi, I'm Ana Torres from Nube Andina. You can reach me at ana.torres@example.com."],
    grader: {
      type: "JSON_EXACT",
      version: 1,
      expected: { name: "Ana Torres", email: "ana.torres@example.com", company: "Nube Andina" },
    },
  },
  {
    key: "json-inventory-extraction",
    name: "Practical SLM · JSON · Inventory extraction",
    systemPrompt: "Return only valid JSON with exactly the keys sku, quantity, and warehouse. quantity must be a JSON number.",
    userMessages: ["Move 37 units of SKU AX-204 from warehouse Quito-Norte."],
    grader: {
      type: "JSON_EXACT",
      version: 1,
      expected: { sku: "AX-204", quantity: 37, warehouse: "Quito-Norte" },
    },
  },
  {
    key: "json-event-extraction",
    name: "Practical SLM · JSON · Event extraction",
    systemPrompt: "Return only valid JSON with exactly the keys date, time, and attendees. attendees must be a JSON number.",
    userMessages: ["Schedule the review for 2026-10-14 at 16:30 with 6 attendees."],
    grader: {
      type: "JSON_EXACT",
      version: 1,
      expected: { date: "2026-10-14", time: "16:30", attendees: 6 },
    },
  },
  {
    key: "instruction-transform",
    name: "Practical SLM · Instruction · Ordered transform",
    systemPrompt: "Follow the formatting instruction exactly. Output no explanation.",
    userMessages: ["Sort these words alphabetically, convert them to uppercase, and join them with a single pipe character: red, blue, green"],
    grader: { type: "EXACT_TEXT", version: 1, expected: "BLUE|GREEN|RED", caseSensitive: true, collapseWhitespace: false },
  },
  {
    key: "instruction-spanish",
    name: "Practical SLM · Instruction · Spanish constraint",
    systemPrompt: "Sigue la instrucción exactamente y no agregues explicación.",
    userMessages: ["Devuelve exactamente tres palabras separadas por una sola coma, sin espacios, en este orden: nube, río, volcán"],
    grader: { type: "EXACT_TEXT", version: 1, expected: "nube,río,volcán", caseSensitive: true, collapseWhitespace: false },
  },
  {
    key: "instruction-required-forbidden",
    name: "Practical SLM · Instruction · Required and forbidden content",
    systemPrompt: "Answer in one short sentence. You must mention both TLS and certificate. You must not mention password or VPN.",
    userMessages: ["What two things should I verify first when a browser reports an HTTPS trust error?"],
    grader: {
      type: "CONTAINS_ALL",
      version: 1,
      required: ["TLS", "certificate"],
      forbidden: ["password", "VPN"],
      caseSensitive: false,
    },
  },
  {
    key: "reasoning-multiplication",
    name: "Practical SLM · Reasoning · Multiplication",
    systemPrompt: "Solve the problem and return only the final numeric answer.",
    userMessages: ["What is 17 × 23?"],
    grader: { type: "NUMBER", version: 1, expected: 391, tolerance: 0 },
  },
  {
    key: "reasoning-percentage",
    name: "Practical SLM · Reasoning · Percentage",
    systemPrompt: "Solve the problem and return only the final numeric answer.",
    userMessages: ["What is 15% of 260?"],
    grader: { type: "NUMBER", version: 1, expected: 39, tolerance: 0 },
  },
  {
    key: "reasoning-average",
    name: "Practical SLM · Reasoning · Average",
    systemPrompt: "Solve the problem and return only the final numeric answer.",
    userMessages: ["What is the arithmetic mean of 12, 18, 25, and 5?"],
    grader: { type: "NUMBER", version: 1, expected: 15, tolerance: 0 },
  },
  {
    key: "retrieval-access-code",
    name: "Practical SLM · Retrieval · Access code",
    systemPrompt: "Answer using only the supplied context. Return only the requested value, with no explanation.",
    userMessages: [
      "Context:\nProject Cedar uses region us-east-2. Project Maple uses region eu-west-1. Project Quartz uses access code QZ-7319 and region ap-southeast-2. Project Amber uses access code AM-2281.\n\nQuestion: What is the access code for Project Quartz?",
    ],
    grader: { type: "EXACT_TEXT", version: 1, expected: "QZ-7319", caseSensitive: true, collapseWhitespace: false },
  },
  {
    key: "retrieval-latest-status",
    name: "Practical SLM · Retrieval · Latest status",
    systemPrompt: "Use only the supplied records. Return only the status value from the chronologically latest record.",
    userMessages: [
      "Records:\n2026-04-02T09:00:00Z status=DEGRADED\n2026-04-02T11:30:00Z status=RECOVERING\n2026-04-02T10:45:00Z status=DOWN\n2026-04-02T12:05:00Z status=HEALTHY",
    ],
    grader: { type: "EXACT_TEXT", version: 1, expected: "HEALTHY", caseSensitive: true, collapseWhitespace: false },
  },
  {
    key: "multiturn-state",
    name: "Practical SLM · State · Multi-turn memory",
    systemPrompt: "Keep track of facts stated by the user across turns. On the final turn, output only the requested value.",
    userMessages: [
      "For this conversation, remember that the deployment batch number is 17.",
      "The staging batch number is 9. Do not replace the deployment batch number.",
      "What is the deployment batch number? Return only the number.",
    ],
    grader: { type: "NUMBER", version: 1, expected: 17, tolerance: 0 },
  },
];
