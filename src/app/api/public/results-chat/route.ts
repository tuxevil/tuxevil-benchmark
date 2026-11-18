import { answerResultsChat } from "@/lib/results-chat";

export function POST(request: Request) {
  return answerResultsChat(request, "public");
}
